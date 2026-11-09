import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { metricsSchema, tokensSchema, usageStateSchema, type Tokens, type UsageCall, type UsageMetrics, type UsageReport, type UsageState } from "../shared/usage";

export function readTokens(output: string): Tokens | null {
  let tokens: Tokens | null = null;
  for (const line of output.split("\n")) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== "turn.completed" || !event.usage) continue;
    const usage = event.usage;
    const parsed = tokensSchema.safeParse({inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
      cachedInputTokens: usage.cached_input_tokens ?? null, reasoningTokens: usage.reasoning_output_tokens ?? usage.output_tokens_details?.reasoning_tokens ?? null});
    if (parsed.success && (parsed.data.cachedInputTokens ?? 0) <= parsed.data.inputTokens && (parsed.data.reasoningTokens ?? 0) <= parsed.data.outputTokens) tokens = parsed.data;
  }
  // One CLI invocation has one final turn summary. Never add cached input or reasoning twice.
  return tokens;
}

export function metricsFor(call: UsageCall): UsageMetrics {
  const metrics = metricsSchema.parse({calls: 1, [call.status]: 1, inputBytes: call.inputBytes, outputBytes: call.outputBytes, activityCount: call.activityCount});
  if (call.tokens) Object.assign(metrics, {reportedCalls: 1, inputTokens: call.tokens.inputTokens, outputTokens: call.tokens.outputTokens,
    cachedInputTokens: call.tokens.cachedInputTokens ?? 0, cachedReportedCalls: call.tokens.cachedInputTokens === null ? 0 : 1,
    reasoningTokens: call.tokens.reasoningTokens ?? 0, reasoningReportedCalls: call.tokens.reasoningTokens === null ? 0 : 1});
  if (call.durationMs !== null) Object.assign(metrics, {durationMs: call.durationMs, timedCalls: 1, maxDurationMs: call.durationMs});
  return metrics;
}
export function addMetrics(target: UsageMetrics, source: UsageMetrics) {
  for (const key of Object.keys(target) as (keyof UsageMetrics)[]) target[key] = key === "maxDurationMs" ? Math.max(target[key], source[key]) : target[key] + source[key];
  return target;
}

export class UsageLedger {
  state: UsageState = {version: 1, startedAt: new Date().toISOString(), recent: [], buckets: []};
  error: string | null = null;
  private writes = Promise.resolve();
  constructor(readonly directory: string) {}
  async load() {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    try { this.state = usageStateSchema.parse(JSON.parse(await readFile(join(this.directory, "usage.json"), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Saved usage is unreadable; preserved without resetting totals"); }
    for (const call of this.state.recent) if (call.status === "running") {
      call.status = "interrupted"; call.finishedAt = new Date().toISOString(); call.error = "Plugin stopped before the call finished";
      this.aggregate(call);
    }
    await this.save();
  }
  save() {
    const data = JSON.stringify(this.state);
    const next = this.writes.catch(() => {}).then(async () => {
      const file = join(this.directory, "usage.json");
      await writeFile(`${file}.tmp`, data, {mode: 0o600}); await rename(`${file}.tmp`, file); this.error = null;
    }).catch(error => { this.error = "Usage could not be saved"; throw error; });
    this.writes = next; return next;
  }
  async begin(input: Pick<UsageCall, "task" | "projectId" | "projectName" | "workspaceId" | "workspaceName" | "sessionTitle" | "inputBytes" | "activityCount"> & {model?: string}) {
    const call: UsageCall = {...input, id: randomUUID(), model: input.model ?? "gpt-6-luna", startedAt: new Date().toISOString(), finishedAt: null, durationMs: null,
      status: "running", tokens: null, outputBytes: 0, error: null};
    this.state.recent.push(call);
    // Aggregate history stays intact; retain at most 300 completed call details plus running calls.
    const completed = this.state.recent.filter(row => row.status !== "running").slice(-300);
    this.state.recent = [...completed, ...this.state.recent.filter(row => row.status === "running")].sort((a,b) => a.startedAt.localeCompare(b.startedAt));
    try { await this.save(); }
    catch (error) { this.state.recent = this.state.recent.filter(row => row.id !== call.id); throw error; }
    return call.id;
  }
  async finish(id: string, result: Pick<UsageCall, "status" | "tokens" | "outputBytes" | "error" | "durationMs">) {
    const call = this.state.recent.find(row => row.id === id);
    if (!call || call.status !== "running") return;
    Object.assign(call, result, {finishedAt: new Date().toISOString()});
    this.aggregate(call);
    const completed = this.state.recent.filter(row => row.status !== "running").slice(-300);
    this.state.recent = [...completed, ...this.state.recent.filter(row => row.status === "running")].sort((a,b) => a.startedAt.localeCompare(b.startedAt));
    await this.save();
  }
  private aggregate(call: UsageCall) {
    const day = call.startedAt.slice(0, 10);
    let bucket = this.state.buckets.find(row => row.day === day && row.task === call.task && row.projectId === call.projectId);
    if (!bucket) { bucket = {day, task: call.task, projectId: call.projectId, projectName: call.projectName, metrics: metricsSchema.parse({})}; this.state.buckets.push(bucket); }
    addMetrics(bucket.metrics, metricsFor(call));
  }
  report(period: "today" | "week" | "all", now = new Date()): UsageReport {
    const cutoff = period === "all" ? "" : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (period === "week" ? 6 : 0))).toISOString().slice(0, 10);
    const totals = metricsSchema.parse({});
    const byTask = new Map<UsageCall["task"], UsageMetrics>();
    const byProject = new Map<string, {projectId: string; projectName: string; metrics: UsageMetrics}>();
    const daily = new Map<string, UsageMetrics>();
    const rows = [...this.state.buckets.filter(row => row.day >= cutoff), ...this.state.recent.filter(call => call.status === "running" && call.startedAt.slice(0,10) >= cutoff).map(call => ({day: call.startedAt.slice(0,10), task: call.task, projectId: call.projectId, projectName: call.projectName, metrics: metricsFor(call)}))];
    for (const row of rows) {
      addMetrics(totals, row.metrics);
      const task = byTask.get(row.task) ?? metricsSchema.parse({}); addMetrics(task, row.metrics); byTask.set(row.task, task);
      const project = byProject.get(row.projectId) ?? {projectId: row.projectId, projectName: row.projectName, metrics: metricsSchema.parse({})};
      addMetrics(project.metrics, row.metrics); byProject.set(row.projectId, project);
      const day = daily.get(row.day) ?? metricsSchema.parse({}); addMetrics(day, row.metrics); daily.set(row.day, day);
    }
    return {startedAt: this.state.startedAt, error: this.error, totals, byTask: [...byTask].map(([task, metrics]) => ({task, metrics})), byProject: [...byProject.values()],
      daily: [...daily].sort(([a],[b]) => a.localeCompare(b)).slice(-30).map(([day, metrics]) => ({day, metrics})),
      recent: this.state.recent.filter(call => call.startedAt.slice(0,10) >= cutoff).slice(-30).reverse()};
  }
  async flush() { await this.writes; }
}
