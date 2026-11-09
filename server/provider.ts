import type {PluginHandlerContext} from "@getpaseo/plugin/server";
import {mkdir, mkdtemp, rm} from "node:fs/promises";
import {join, resolve} from "node:path";
import {tokensSchema, type Tokens} from "../shared/usage";

type PaseoApi = PluginHandlerContext["paseo"];
type Agent = Awaited<ReturnType<PaseoApi["agents"]["create"]>>;
export type HelperRequest = {cwd: string; selection: string; instructions: string; thinkingOptionId?: string; options?: Record<string, unknown>; schema: Record<string, unknown>; prompt: string};
export type CreateHelper = (request: HelperRequest) => Promise<Agent>;
// Background helpers use the supported creation API. Delete only the temporary
// project whose root exactly matches this helper's freshly created directory.
export function managedHelper(paseo: PaseoApi, removeProject: (id: string) => Promise<unknown>): CreateHelper {
  return async request => {
    const cleanupProject = async () => {
      const projects = await paseo.projects.list();
      for (const project of projects.projects) {
        if (resolve(project.projectRootPath) === resolve(request.cwd)) await removeProject(project.projectId);
      }
    };
    let helper: Agent;
    try {
      helper = await paseo.agents.create({cwd: request.cwd, background: true, title: "Overseer review",
        config: {provider: request.selection, systemPrompt: request.instructions, thinkingOptionId: request.thinkingOptionId,
          options: request.options, mcpServers: {}, toolPolicy: {preapproved: []}},
        outputSchema: request.schema, prompt: request.prompt});
    } catch (error) { await cleanupProject().catch(() => {console.warn("Overseer temporary project could not be removed");}); throw error; }
    const archive = async () => {
      try { await helper.archive(); }
      finally { await cleanupProject(); }
    };
    return new Proxy(helper, {get: (target, property, receiver) => property === "archive" ? archive : Reflect.get(target, property, receiver)});
  };
}

export type ProviderResult = {text: string; tokens: Tokens | null; costUsd: number | null};
export type ProviderExecute = (selection: string, input: string, instructions: string, schema: Record<string, unknown>, signal: AbortSignal) => Promise<ProviderResult>;
export class ProviderError extends Error {
  constructor(message: string, readonly result: ProviderResult) { super(message); }
}
export function splitSelection(selection: string) {
  const slash = selection.indexOf("/");
  if (slash < 1 || slash === selection.length - 1) throw new Error("Choose a provider and model in Overseer settings");
  return {provider: selection.slice(0, slash), model: selection.slice(slash + 1)};
}
export function reportedUsage(usage: {inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; totalCostUsd?: number} | null | undefined) {
  const parsed = tokensSchema.safeParse({inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, cachedInputTokens: usage?.cachedInputTokens ?? null, reasoningTokens: null});
  const tokens = parsed.success && (parsed.data.cachedInputTokens ?? 0) <= parsed.data.inputTokens ? parsed.data : null;
  const costUsd = typeof usage?.totalCostUsd === "number" && Number.isFinite(usage.totalCostUsd) && usage.totalCostUsd >= 0 ? usage.totalCostUsd : null;
  return {tokens, costUsd};
}

// Provider-specific restrictions supplement the common no-tool instructions. Custom
// providers keep their own validated options rather than receiving another provider's flags.
export function helperOptions(provider: string): Record<string, unknown> | undefined {
  if (provider === "claude") return {allowedTools: [], disallowedTools: ["*"], extraArgs: {tools: ""}};
  if (provider === "codex") return {sandbox_mode: "read-only", approval_policy: "on-request", web_search: "disabled"};
  if (provider === "opencode") return {permission: "deny"};
  return undefined;
}

export function providerExecutor(paseo: PaseoApi, directory: string, createHelper: CreateHelper, timeoutMs = 90000): ProviderExecute {
  return async (selection, input, instructions, schema, signal) => {
    const {provider, model} = splitSelection(selection);
    let result: ProviderResult = {text: "", tokens: null, costUsd: null};
    let helper: Agent | undefined, cwd: string | undefined;
    let canceled = false;
    const controller = new AbortController();
    const abort = () => { canceled = true; controller.abort(); };
    signal.addEventListener("abort", abort, {once: true});
    if (signal.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    const aborted = new Promise<never>((_, reject) => {
      if (controller.signal.aborted) reject(new Error("Observer canceled"));
      else controller.signal.addEventListener("abort", () => reject(new Error(signal.aborted ? "Observer canceled" : "Provider review timed out")), {once: true});
    });
    const cleanup = async (agent: Agent) => {
      await agent.archive();
    };
    const work = (async () => {
      if (canceled) throw new Error("Observer canceled");
      const snapshot = await paseo.providers.waitForReady({cwd: directory, timeoutMs: Math.min(timeoutMs, 15000)});
      const entry = snapshot.entries.find(row => row.provider === provider);
      if (!entry?.enabled || entry.status !== "ready") throw new Error(`${entry?.label ?? provider} is not enabled and ready in Paseo`);
      const models = await paseo.providers.listModels(provider, {cwd: directory});
      const selected = models.models?.find(row => row.id === model || row.aliases?.includes(model));
      if (!selected || selected.isSelectable === false) throw new Error(`The selected model is unavailable. Choose a model in Overseer settings.`);
      if (canceled) throw new Error("Observer canceled");
      await mkdir(directory, {recursive: true, mode: 0o700});
      cwd = await mkdtemp(join(directory, "review-"));
      const thinkingOptionId = ["minimal", "off", "low"].find(id => selected.thinkingOptions?.some(option => option.id === id));
      helper = await createHelper({cwd, selection, instructions, thinkingOptionId, options: helperOptions(provider), schema,
        prompt: `Return a JSON object matching this schema:\n${JSON.stringify(schema)}\n\nObserved activity:\n${input}`});
      if (canceled) throw new Error("Observer canceled");
      const completed = await helper.waitForFinish(timeoutMs);
      result = {text: completed.lastMessage ?? "", ...reportedUsage(completed.final?.lastUsage ?? helper.lastUsage)};
      if (completed.status !== "idle") throw new Error(completed.error ?? (completed.status === "permission" ? "Observer requested a tool or permission; review rejected" : `Provider review ${completed.status}`));
      if (result.text.length > 200000) throw new Error("Provider response exceeded the review size limit");
      if (!result.text) throw new Error("Provider returned no analysis");
      return result;
    })();
    try { return await Promise.race([work, aborted]); }
    catch (error) {
      if (helper?.lastUsage) result = {...result, ...reportedUsage(helper.lastUsage)};
      throw new ProviderError(error instanceof Error ? error.message : "Provider review failed", result);
    } finally {
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      // If creation completes after cancellation, release that exact helper too.
      if (helper) await cleanup(helper).catch(() => {console.warn("Overseer helper could not be archived");});
      else void work.catch(() => {}).finally(async () => {
        if (helper) await cleanup(helper).catch(() => {console.warn("Overseer helper could not be archived");});
        if (cwd) await rm(cwd, {recursive: true, force: true}).catch(() => {});
      });
      if (helper && cwd) await rm(cwd, {recursive: true, force: true}).catch(() => {});
    }
  };
}
