import { findingKey, type SessionView } from "./contracts";

export function sessionKind(title: string | null, labels: Record<string, string> = {}): "work" | "inbox" {
  return labels["event-inbox.workspace"] || /^(Slack|Gmail|GitHub):/i.test(title ?? "") ? "inbox" : "work";
}

export function projectBrief(sessions: SessionView[], dismissed: string[], includeUnwatched = false) {
  const reportable = sessions.filter(session => includeUnwatched || session.status !== "not watched");
  const findings = reportable.flatMap(session => (session.analysis?.findings ?? [])
    .filter(finding => !dismissed.includes(findingKey(session.id, finding))).map(finding => ({session, finding})));
  const watched = sessions.filter(session => session.status !== "not watched");
  const work = reportable.filter(session => session.kind !== "inbox");
  const waiting = watched.filter(session => session.pendingCount || !session.analysis || session.coverage === "recovering");
  const failed = watched.filter(session => session.error);
  const workspaces = Object.values(work.reduce<Record<string, {id: string; title: string; owners: SessionView[]}>>((result, session) => {
    const workspace = result[session.workspaceId] ??= {id: session.workspaceId, title: session.workspaceTitle, owners: []};
    workspace.owners.push(session); return result;
  }, {})).sort((a,b) => Number(b.owners.some(session => session.status === "running")) - Number(a.owners.some(session => session.status === "running")));
  const needsDecision = reportable.flatMap(session => (session.analysis?.needsDecision ?? []).map(request => ({session, request})));
  const recent = work.filter(session => session.analysis?.recentChange && session.lastActivityAt)
    .sort((a,b) => b.lastActivityAt!.localeCompare(a.lastActivityAt!)).slice(0, 6);
  return {workspaces, findings, needsDecision, recent, inboxCount: sessions.filter(session => session.kind === "inbox").length,
    watchedCount: watched.length, waitingCount: waiting.length, failedCount: failed.length,
    incompleteCount: watched.filter(session => session.historyIncomplete).length,
    lastReviewedAt: sessions.map(session => session.updatedAt).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null};
}
