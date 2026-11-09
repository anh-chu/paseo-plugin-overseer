import { describe, expect, it } from "vitest";
import { activity, batch, checkedAnalysis, genericName, ingest } from "./activity";
import { analysisSchema, sessionSchema, type Session } from "../shared/contracts";

export function session(id = "one", projectId = "project"): Session {
  return sessionSchema.parse({id, projectId, projectName: "Example", workspaceId: "workspace", workspaceTitle: "Reports", title: "Report results", status: "running"});
}
export const analysis = analysisSchema.parse({purpose: "Fix report results", scope: ["Reports"], decisions: [], resources: ["src/reports.ts"],
  nextAction: "Check the report output", suggestedName: "Fix report results", workspaceName: "Reliable report results", findings: []});

describe("incremental activity", () => {
  it("deduplicates replay and retains a growing row at the same sequence", () => {
    const state = session();
    const row = (text: string) => ({seqStart: 4, seqEnd: 4, item: {type: "assistant_message", text}});
    ingest(state, [row("Investigating reports")]);
    ingest(state, [row("Investigating reports")]);
    expect(state.pending).toHaveLength(1);
    ingest(state, [row("Investigating reports and result counts")]);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].text).toContain("result counts");
    expect(state.cursor).toBe(4);
  });
  it("keeps every unprocessed entry when building bounded batches", () => {
    const rows = [activity(1, {type: "user_message", text: "first"})!, activity(2, {type: "assistant_message", text: "second"})!];
    expect(batch(rows, 5)).toEqual([rows[0]]);
    expect(rows).toHaveLength(2);
  });
  it("ignores its own timeline notes and reasoning", () => {
    expect(activity(1, {type: "plugin", text: "Alert"})).toBeNull();
    expect(activity(2, {type: "reasoning", text: "Private thought"})).toBeNull();
  });
});

describe("evidence and names", () => {
  it("rejects invented decision requests and preserves a previously evidenced open request", () => {
    const own = session();
    const row = activity(5, {type: "assistant_message", text: "Should the report export use CSV or JSON?"})!;
    const request = {question: "CSV or JSON for the report export?", evidence: {sessionId: own.id, seq: 5, quote: row.text}};
    const reviewed = checkedAnalysis({...analysis, needsDecision: [request]}, own, [], [row]);
    expect(reviewed.needsDecision).toHaveLength(1);
    expect(checkedAnalysis({...analysis, needsDecision: [{...request, evidence: {...request.evidence, quote: "Invented approval request"}}]}, own, [], [row]).needsDecision).toHaveLength(0);
    expect(checkedAnalysis({...analysis, needsDecision: [request]}, own, [], [{...row, role: "user_message"}]).needsDecision).toHaveLength(0);
    own.analysis = reviewed;
    expect(checkedAnalysis({...analysis, needsDecision: [request]}, own, [], []).needsDecision).toHaveLength(1);
    expect(checkedAnalysis({...analysis, needsDecision: []}, own, [], []).needsDecision).toHaveLength(0);
  });
  it("keeps source activity time separate from observer review time", () => {
    const own = session();
    ingest(own, [{seqStart: 1, seqEnd: 1, timestamp: "2026-11-09T11:00:00+07:00", item: {type: "user_message", text: "Check report counts"}}]);
    expect(own.lastActivityAt).toBe("2026-11-09T04:00:00.000Z");
    ingest(own, [{seqStart: 1, seqEnd: 1, timestamp: "2026-11-08T04:00:00Z", item: {type: "user_message", text: "Check report counts"}}]);
    expect(own.lastActivityAt).toBe("2026-11-09T04:00:00.000Z");
  });
  it("rejects invented quotations and unknown peers", () => {
    const own = session(), peer = session("two");
    const row = activity(1, {type: "user_message", text: "Only work on report counts"})!;
    const finding = {kind: "scope" as const, title: "Scope expanded", detail: "Work expanded", action: "Return to reports", otherSessionId: null,
      evidence: [{sessionId: own.id, seq: 1, quote: "Only work on report counts"}]};
    expect(checkedAnalysis({...analysis, findings: [finding]}, own, [peer], [row]).findings).toHaveLength(1);
    expect(checkedAnalysis({...analysis, findings: [{...finding, evidence: [{...finding.evidence[0], quote: "invented quotation"}]}]}, own, [peer], [row]).findings).toHaveLength(0);
    expect(checkedAnalysis({...analysis, findings: [{...finding, otherSessionId: "unknown"}]}, own, [peer], [row]).findings).toHaveLength(0);
  });
  it("does not treat readable manual names as generic", () => {
    expect(genericName("Manual QA pilot")).toBe(false);
    expect(genericName("main")).toBe(true);
    expect(genericName("New session")).toBe(true);
  });
});
