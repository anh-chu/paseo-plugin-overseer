import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const tokensSchema = z.object({
  inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative().nullable(), reasoningTokens: z.number().int().nonnegative().nullable(),
});
export type Tokens = z.infer<typeof tokensSchema>;
export const callSchema = z.object({
  id: z.string(), task: z.enum(["session_review", "workspace_naming"]), model: z.literal("gpt-6-luna"),
  projectId: z.string(), projectName: z.string(), workspaceId: z.string(), workspaceName: z.string(), sessionTitle: z.string(),
  startedAt: z.string(), finishedAt: z.string().nullable(), durationMs: z.number().nonnegative().nullable(),
  status: z.enum(["running", "completed", "failed", "canceled", "interrupted"]),
  tokens: tokensSchema.nullable(), inputBytes: z.number().nonnegative(), outputBytes: z.number().nonnegative(),
  activityCount: z.number().int().nonnegative(), error: z.string().nullable(),
});
export type UsageCall = z.infer<typeof callSchema>;
export const metricsSchema = z.object({
  calls: z.number().default(0), completed: z.number().default(0), failed: z.number().default(0), canceled: z.number().default(0), interrupted: z.number().default(0), running: z.number().default(0),
  reportedCalls: z.number().default(0), cachedReportedCalls: z.number().default(0), reasoningReportedCalls: z.number().default(0),
  inputTokens: z.number().default(0), cachedInputTokens: z.number().default(0), outputTokens: z.number().default(0), reasoningTokens: z.number().default(0),
  inputBytes: z.number().default(0), outputBytes: z.number().default(0), activityCount: z.number().default(0),
  durationMs: z.number().default(0), timedCalls: z.number().default(0), maxDurationMs: z.number().default(0),
});
export type UsageMetrics = z.infer<typeof metricsSchema>;
export const usageStateSchema = z.object({
  version: z.literal(1), startedAt: z.string(), recent: z.array(callSchema),
  buckets: z.array(z.object({day: z.string(), task: callSchema.shape.task, projectId: z.string(), projectName: z.string(), metrics: metricsSchema})),
});
export type UsageState = z.infer<typeof usageStateSchema>;
export const usageReportSchema = z.object({
  startedAt: z.string(), error: z.string().nullable(), totals: metricsSchema,
  byTask: z.array(z.object({task: callSchema.shape.task, metrics: metricsSchema})),
  byProject: z.array(z.object({projectId: z.string(), projectName: z.string(), metrics: metricsSchema})),
  daily: z.array(z.object({day: z.string(), metrics: metricsSchema})),
  recent: z.array(callSchema),
});
export type UsageReport = z.infer<typeof usageReportSchema>;
export const usageRpc = defineRpc({name: "overseer.usage", input: z.object({period: z.enum(["today", "week", "all"]).default("all")}), output: usageReportSchema});
