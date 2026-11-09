import { expect, it } from "vitest";
import { projectBrief, sessionKind } from "./brief";
import { analysisSchema, findingKey, sessionViewSchema } from "./contracts";

const analysis = analysisSchema.parse({purpose: "Fix missing report counts", scope: ["Report counts"], decisions: [], resources: [], nextAction: "Check the export", suggestedName: "Fix report counts", workspaceName: "Reliable report counts", findings: []});
const session = (id: string, patch: Record<string, unknown> = {}) => sessionViewSchema.parse({id, workspaceId: "reports", projectId: "example", projectName: "Example", workspaceTitle: "Reports", title: "Reports", status: "idle", pendingCount: 0, workspaceNameLocked: false, analysis, updatedAt: "2026-11-09T04:00:00Z", ...patch});

it("groups work owners and keeps routine inbox activity out of ownership", () => {
  const first = session("one"), second = session("two"), inbox = session("inbox", {kind: "inbox", workspaceId: "inbox"});
  const brief = projectBrief([first, second, inbox], []);
  expect(brief.workspaces).toHaveLength(1);
  expect(brief.workspaces[0].owners.map(owner => owner.id)).toEqual(["one", "two"]);
  expect(brief.inboxCount).toBe(1);
  expect(brief.watchedCount).toBe(3);
});

it("does not imply that unreviewed, pending, or recovering sessions are caught up", () => {
  const brief = projectBrief([session("new", {analysis: null}), session("pending", {pendingCount: 2}), session("recovery", {coverage: "recovering"}), session("stopped", {status: "not watched", pendingCount: 1}), session("failed", {error: "Offline"})], []);
  expect(brief.waitingCount).toBe(3);
  expect(brief.failedCount).toBe(1);
  expect(brief.watchedCount).toBe(4);
});

it("keeps evidenced inbox decisions visible while excluding dismissed concerns", () => {
  const finding = {kind: "scope" as const, title: "Scope expanded", detail: "An unrelated area was added", action: "Return to reports", otherSessionId: null, evidence: [{sessionId: "one", seq: 1, quote: "Only fix report counts"}]};
  const decision = {question: "Approve the reply draft?", evidence: {sessionId: "inbox", seq: 2, quote: "Would you like to approve this draft?"}};
  const brief = projectBrief([session("one", {analysis: {...analysis, findings: [finding]}}), session("inbox", {kind: "inbox", analysis: {...analysis, needsDecision: [decision]}})], [findingKey("one", finding)]);
  expect(brief.findings).toHaveLength(0);
  expect(brief.needsDecision[0].request.question).toBe("Approve the reply draft?");
});

it("orders changes by source activity time rather than a fresh observer review", () => {
  const brief = projectBrief([session("older", {lastActivityAt: "2026-11-01T12:00:00Z", updatedAt: "2026-11-09T12:00:00Z", analysis: {...analysis, recentChange: "Checked older reports"}}), session("newer", {lastActivityAt: "2026-11-08T12:00:00Z", analysis: {...analysis, recentChange: "Fixed the report export"}}), session("unknown", {analysis: {...analysis, recentChange: "Changed something"}})], []);
  expect(brief.recent.map(item => item.id)).toEqual(["newer", "older"]);
});

it("recognizes inbox labels even after an automated title has been renamed", () => {
  expect(sessionKind("Review the customer reply", {"event-inbox.workspace": "main"})).toBe("inbox");
  expect(sessionKind("Slack: customer reply")).toBe("inbox");
  expect(sessionKind("Build Slack integration")).toBe("work");
});

it("excludes sessions no longer watched from current ownership but retains last known work while paused", () => {
  const rows = [session("active"), session("archived", {status: "not watched"})];
  expect(projectBrief(rows, []).workspaces[0].owners.map(owner => owner.id)).toEqual(["active"]);
  expect(projectBrief(rows, [], true).workspaces[0].owners).toHaveLength(2);
});
