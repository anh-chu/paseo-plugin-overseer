import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageLedger, readTokens } from "./usage";
import { CommandError, Luna } from "./model";
import { analysisSchema, sessionSchema } from "../shared/contracts";

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); for (const path of directories.splice(0)) await rm(path, {recursive: true, force: true}); });
const input = {task: "session_review" as const, projectId: "project", projectName: "Example", workspaceId: "workspace", workspaceName: "Reports", sessionTitle: "Check report counts", inputBytes: 100, activityCount: 2};
const tokens = {inputTokens: 1000, cachedInputTokens: 800, outputTokens: 100, reasoningTokens: 40};
const finished = {status: "completed" as const, tokens, outputBytes: 120, durationMs: 500, error: null};
async function ledger() { const directory = await mkdtemp("/tmp/overseer-usage-"); directories.push(directory); const usage = new UsageLedger(directory); await usage.load(); return usage; }

describe("Codex usage decoding", () => {
  it("reads reported totals without adding cache or reasoning twice", () => {
    const output = JSON.stringify({type: "turn.completed", usage: {input_tokens: 1000, cached_input_tokens: 800, output_tokens: 100, reasoning_output_tokens: 40}});
    expect(readTokens(output)).toEqual(tokens);
    expect(readTokens(output + "\n" + output)).toEqual(tokens);
  });
  it("distinguishes omitted fields from reported zeros", () => {
    expect(readTokens('{"type":"turn.completed","usage":{"input_tokens":0,"output_tokens":0}}')).toEqual({inputTokens: 0, outputTokens: 0, cachedInputTokens: null, reasoningTokens: null});
    expect(readTokens('{"type":"turn.failed"}')).toBeNull();
    expect(readTokens("partial invalid output")).toBeNull();
  });
  it("rejects invalid or inconsistent token counters", () => {
    expect(readTokens('{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":20,"output_tokens":1}}')).toBeNull();
    expect(readTokens('{"type":"turn.completed","usage":{"input_tokens":-1,"output_tokens":1}}')).toBeNull();
  });
});

describe("durable accounting", () => {
  it("counts running requests once, then finalizes once across reloads", async () => {
    const usage = await ledger(); const id = await usage.begin(input);
    expect(usage.report("all").totals).toMatchObject({calls: 1, running: 1, reportedCalls: 0});
    await usage.finish(id, finished); await usage.finish(id, finished);
    const restored = new UsageLedger(usage.directory); await restored.load();
    expect(restored.report("all").totals).toMatchObject({calls: 1, completed: 1, running: 0, reportedCalls: 1, inputTokens: 1000, cachedInputTokens: 800, outputTokens: 100, reasoningTokens: 40, durationMs: 500});
  });
  it("keeps failures without token reports as unknown and retains reported tokens on failed calls", async () => {
    const usage = await ledger();
    await usage.finish(await usage.begin(input), {...finished, status: "failed", tokens: null});
    await usage.finish(await usage.begin(input), {...finished, status: "failed"});
    expect(usage.report("all").totals).toMatchObject({calls: 2, failed: 2, reportedCalls: 1, inputTokens: 1000});
    expect(usage.report("all").recent.some(call => call.tokens === null)).toBe(true);
  });
  it("marks abandoned calls interrupted on restart without inventing time or tokens", async () => {
    const usage = await ledger(); await usage.begin(input);
    const restored = new UsageLedger(usage.directory); await restored.load();
    const again = new UsageLedger(usage.directory); await again.load();
    expect(again.report("all").totals).toMatchObject({calls: 1, interrupted: 1, running: 0, reportedCalls: 0, timedCalls: 0});
    expect(again.report("all").recent[0].durationMs).toBeNull();
  });
  it("filters days in UTC and separates workspace naming from session reviews", async () => {
    const usage = await ledger();
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T23:59:59Z"));
    await usage.finish(await usage.begin(input), finished);
    vi.setSystemTime(new Date("2026-11-09T00:00:01Z"));
    await usage.finish(await usage.begin({...input, task: "workspace_naming"}), {...finished, durationMs: 900});
    expect(usage.report("today").totals.calls).toBe(1);
    expect(usage.report("week").totals.calls).toBe(2);
    expect(usage.report("all").byTask).toHaveLength(2);
    expect(usage.report("all").totals.maxDurationMs).toBe(900);
  });
  it("retains aggregate totals when detailed history is pruned", async () => {
    const usage = await ledger();
    vi.spyOn(usage, "save").mockResolvedValue();
    for (let i = 0; i < 305; i++) await usage.finish(await usage.begin(input), finished);
    expect(usage.state.recent.length).toBeLessThanOrEqual(300);
    expect(usage.report("all").totals.calls).toBe(305);
    expect(usage.report("all").totals.inputTokens).toBe(305000);
  });
  it("preserves corrupt files instead of resetting totals", async () => {
    const usage = await ledger(); const file = join(usage.directory, "usage.json"); await writeFile(file, "broken");
    await expect(new UsageLedger(usage.directory).load()).rejects.toThrow("preserved");
    expect(await readFile(file, "utf8")).toBe("broken");
  });
});

it("records model usage even when a process fails after reporting tokens", async () => {
  const usage = await ledger();
  const output = JSON.stringify({type: "turn.completed", usage: {input_tokens: 1000, cached_input_tokens: 800, output_tokens: 100, reasoning_output_tokens: 40}});
  const model = new Luna(join(usage.directory, "helper"), usage, vi.fn().mockRejectedValue(new CommandError("Process failed", output)));
  vi.spyOn(model as unknown as {prepare(): Promise<{binary: string; args: string[]}>}, "prepare").mockResolvedValue({binary: "fake", args: []});
  const session = sessionSchema.parse({id: "session", projectId: "project", projectName: "Example", workspaceId: "workspace", workspaceTitle: "Reports", title: "Check report counts", status: "running"});
  await expect(model.analyze(session, [], [], new AbortController().signal)).rejects.toThrow("Process failed");
  expect(usage.report("all").totals).toMatchObject({calls: 1, failed: 1, inputTokens: 1000, reportedCalls: 1});
});

it("records both model purposes while keeping requests serialized", async () => {
  const usage = await ledger(); let active = 0, maximum = 0;
  const analysis = analysisSchema.parse({purpose: "Check report counts", scope: [], decisions: [], resources: [], nextAction: "Check exports", suggestedName: "Check report counts", workspaceName: "Reliable report counts", findings: []});
  const output = [JSON.stringify({type: "item.completed", item: {type: "agent_message", text: JSON.stringify(analysis)}}), JSON.stringify({type: "turn.completed", usage: {input_tokens: 1000, cached_input_tokens: 800, output_tokens: 100, reasoning_output_tokens: 40}})].join("\n");
  const execute = vi.fn(async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 10)); active--; return output; });
  const model = new Luna(join(usage.directory, "helper"), usage, execute);
  vi.spyOn(model as unknown as {prepare(): Promise<{binary: string; args: string[]}>}, "prepare").mockResolvedValue({binary: "fake", args: []});
  const session = sessionSchema.parse({id: "session", projectId: "project", projectName: "Example", workspaceId: "workspace", workspaceTitle: "Reports", title: "Check report counts", status: "running"});
  await Promise.all([model.analyze(session, [], [], new AbortController().signal), model.nameWorkspace([session], new AbortController().signal)]);
  expect(maximum).toBe(1);
  expect(usage.report("all").byTask).toHaveLength(2);
  expect(usage.report("all").totals).toMatchObject({calls: 2, completed: 2, inputTokens: 2000, outputTokens: 200});
});
