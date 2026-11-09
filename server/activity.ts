import { createHash } from "node:crypto";
import type { Activity, Analysis, Session } from "../shared/contracts";

export function activity(seq: number, item: {type: string; text?: unknown}): Activity | null {
  const role = String(item.type);
  if (role === "plugin" || role === "reasoning") return null;
  const content = typeof item.text === "string" ? item.text :
    /tool|permission/.test(role) ? JSON.stringify(item) : "";
  if (!content.trim()) return null;
  const fingerprint = createHash("sha256").update(content).digest("hex");
  return { seq, role, text: content.length > 6000 ? content.slice(0, 6000) + "\n[Activity excerpt; remainder omitted]" : content, fingerprint };
}

export function ingest(session: Session, entries: {seqStart: number; seqEnd: number; item: {type: string; text?: unknown}}[]) {
  for (const entry of entries) {
    const next = activity(entry.seqStart, entry.item);
    session.cursor = Math.max(session.cursor, entry.seqEnd);
    if (!next || session.fingerprints[String(next.seq)] === next.fingerprint) continue;
    session.fingerprints[String(next.seq)] = next.fingerprint;
    // A streaming row may grow at the same sequence position.
    session.pending = session.pending.filter(old => old.seq !== next.seq);
    session.pending.push(next);
    session.recent = [...session.recent.filter(old => old.seq !== next.seq), next].slice(-40);
    if (next.role === "user_message") {
      const anchors = [...session.anchors.filter(old => old.seq !== next.seq), next].sort((a,b) => a.seq-b.seq);
      session.anchors = anchors.length <= 9 ? anchors : [...anchors.slice(0,3), ...anchors.slice(-6)];
    }
  }
  const keys = Object.keys(session.fingerprints).map(Number).sort((a,b) => b-a);
  for (const key of keys.slice(200)) delete session.fingerprints[String(key)];
}

export function batch(pending: Activity[], budget = 18000) {
  const result: Activity[] = [];
  let size = 0;
  for (const entry of pending) {
    if (result.length && size + entry.text.length > budget) break;
    result.push(entry); size += entry.text.length;
  }
  return result;
}

export function checkedAnalysis(result: Analysis, session: Session, peers: Session[], inputs: Activity[]): Analysis {
  const evidence = new Map([[session.id, [...session.anchors, ...session.recent, ...inputs]], ...peers.map(peer => [peer.id, [...peer.anchors, ...peer.recent]] as const)]);
  return { ...result, findings: result.findings.filter(finding => {
    if (finding.otherSessionId && !peers.some(peer => peer.id === finding.otherSessionId)) return false;
    if (finding.kind === "conflict" && !finding.otherSessionId) return false;
    if (!finding.evidence.some(ref => ref.sessionId === session.id)) return false;
    if (finding.kind === "conflict" && !finding.evidence.some(ref => ref.sessionId === finding.otherSessionId)) return false;
    return finding.evidence.every(ref => ref.quote.trim().length >= 12 &&
      evidence.get(ref.sessionId)?.some(row => row.seq === ref.seq && row.text.includes(ref.quote)));
  }) };
}

export function genericName(title: string) {
  return !title.trim() || /^(main|new (agent|chat|session|workspace)|untitled|agent|codex|claude)(\s+\d+)?$/i.test(title) || /^(wks_|prj_|[a-f0-9]{8}-)/i.test(title);
}
