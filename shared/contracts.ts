import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "overseer", scope: "host", version: 1,
  schema: z.object({
    enabled: z.boolean().default(true),
    projectNames: z.array(z.string()).default(["Katalon"]),
    autoName: z.boolean().default(false),
    autoNameWorkspaces: z.boolean().default(true),
  }),
});
export type Settings = z.output<typeof preferences.schema>;
export const evidenceSchema = z.object({ sessionId: z.string(), seq: z.number().int().nonnegative(), quote: z.string().max(240) });
export const findingSchema = z.object({
  kind: z.enum(["conflict", "scope", "behavior"]),
  title: z.string().min(1).max(100), detail: z.string().min(1).max(700),
  action: z.string().min(1).max(300),
  otherSessionId: z.string().nullable(),
  evidence: z.array(evidenceSchema).min(1).max(4),
});
export const decisionSchema = z.object({question: z.string().min(1).max(300), evidence: evidenceSchema});
export const analysisSchema = z.object({
  purpose: z.string().min(1).max(500),
  scope: z.array(z.string().max(240)).max(10),
  decisions: z.array(z.string().max(300)).max(12),
  resources: z.array(z.string().max(240)).max(15),
  nextAction: z.string().max(300),
  suggestedName: z.string().min(5).max(72),
  workspaceName: z.string().min(5).max(72),
  findings: z.array(findingSchema).max(5),
  recentChange: z.string().max(350).default(""),
  needsDecision: z.array(decisionSchema).max(5).default([]),
});
export type Analysis = z.infer<typeof analysisSchema>;
export const activitySchema = z.object({
  seq: z.number().int().nonnegative(), role: z.string(), text: z.string(),
  fingerprint: z.string(),
});
export type Activity = z.infer<typeof activitySchema>;
export const sessionSchema = z.object({
  id: z.string(), workspaceId: z.string(), projectId: z.string(),
  projectName: z.string(), workspaceTitle: z.string(), title: z.string(), status: z.string(),
  kind: z.enum(["work", "inbox"]).default("work"),
  lastActivityAt: z.string().nullable().default(null),
  epoch: z.string().nullable().default(null), cursor: z.number().int().nonnegative().default(0),
  coverage: z.enum(["initial", "following", "partial", "recovering"]).default("initial"),
  historyIncomplete: z.boolean().default(false),
  pending: z.array(activitySchema).default([]),
  recent: z.array(activitySchema).default([]),
  anchors: z.array(activitySchema).default([]),
  fingerprints: z.record(z.string(), z.string()).default({}),
  analysis: analysisSchema.nullable().default(null),
  updatedAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  lastAutoName: z.string().nullable().default(null),
  nameLocked: z.boolean().default(false),
});
export type Session = z.infer<typeof sessionSchema>;
export const stateSchema = z.object({
  version: z.literal(1), sessions: z.record(z.string(), sessionSchema),
  dismissed: z.array(z.string()).default([]),
  workspaceNames: z.record(z.string(), z.object({ name: z.string(), locked: z.boolean(), renamedAt: z.number().default(0) })).default({}),
});
export type State = z.infer<typeof stateSchema>;
export const sessionViewSchema = sessionSchema.omit({ pending: true, recent: true, anchors: true, fingerprints: true }).extend({ pendingCount: z.number(), workspaceNameLocked: z.boolean() });
export type SessionView = z.infer<typeof sessionViewSchema>;
export function findingKey(sessionId: string, finding: Analysis["findings"][number]) {
  return JSON.stringify([sessionId, finding.kind, finding.title, finding.otherSessionId]);
}
export const statusRpc = defineRpc({ name: "overseer.status", input: z.object({}), output: z.object({
  sessions: z.array(sessionViewSchema), enabled: z.boolean(), autoName: z.boolean(), autoNameWorkspaces: z.boolean(),
  busy: z.string().nullable(), error: z.string().nullable(), dismissed: z.array(z.string()),
}) });
export const actionRpc = defineRpc({ name: "overseer.action", input: z.object({
  action: z.enum(["review", "rename", "renameWorkspace", "lock", "lockWorkspace", "dismiss"]),
  sessionId: z.string(), findingKey: z.string().optional(),
}), output: z.object({ ok: z.boolean() }) });
