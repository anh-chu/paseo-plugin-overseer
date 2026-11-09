import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SessionView } from "../shared/contracts";
import { projectBrief } from "../shared/brief";

function reviewedAt(timestamp: string) {
  const date = new Date(timestamp);
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : date.toLocaleString([], {month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});
}

export function ProjectBrief({theme, layout, sessions, dismissed, enabled, onSession, onInbox}: Pick<PluginSurfaceProps, "theme" | "layout"> & {
  sessions: SessionView[]; dismissed: string[]; enabled: boolean; onSession(id: string): void; onInbox(projectId: string): void;
}) {
  const projects = [...new Map(sessions.map(session => [session.projectId, session.projectName])).entries()];
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const projectId = selected && projects.some(([id]) => id === selected) ? selected : projects[0]?.[0];
  const rows = sessions.filter(session => session.projectId === projectId);
  const brief = projectBrief(rows, dismissed, !enabled);
  const c = theme.colors;
  const text = {color: c.foreground, fontSize: 12, lineHeight: 18};
  const muted = {color: c.foregroundMuted, fontSize: 11, lineHeight: 16};
  const heading = {color: c.foreground, fontSize: 14, fontWeight: "700" as const};
  const name = (session: SessionView) => session.analysis?.suggestedName ?? session.title;
  const open = (id: string, label: string) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onSession(id)} style={{alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 7, backgroundColor: c.surface2, borderRadius: 6}}><Text style={{...text, fontWeight: "600"}}>{label}</Text></Pressable>;
  return <View style={{gap: 12}}>
    {projects.length > 1 && <View style={{flexDirection: "row", gap: 8, flexWrap: "wrap"}}>{projects.map(([id, title]) => <Pressable key={id} accessibilityRole="button" onPress={() => setSelected(id)} style={{padding: 12, borderRadius: 8, backgroundColor: id === projectId ? c.foreground : c.surface2}}><Text style={{...text, color: id === projectId ? c.surface0 : c.foreground}}>{title}</Text></Pressable>)}</View>}
    <View style={{gap: 4, paddingBottom: 10, borderBottomWidth: 1, borderColor: c.border}}>
      <View style={{flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8}}>
        <Text style={{...heading, fontSize: 18}}>{projects.find(([id]) => id === projectId)?.[1] ?? "Project brief"}</Text>
        <Text style={muted}>{!enabled ? "Watching paused" : brief.failedCount ? `${brief.failedCount} ${brief.failedCount === 1 ? "review needs" : "reviews need"} attention` : brief.waitingCount ? `${brief.waitingCount} awaiting review` : brief.watchedCount ? "Caught up" : "No sessions watched"}</Text>
      </View>
      <Text style={muted}>{brief.lastReviewedAt ? `Reviewed ${reviewedAt(brief.lastReviewedAt)}` : "Not reviewed yet"}{brief.incompleteCount > 0 ? ` · Partial history in ${brief.incompleteCount} sessions` : ""}</Text>
    </View>
    {(brief.findings.length > 0 || brief.needsDecision.length > 0) && <View style={{gap: 8}}>
      <Text style={heading}>Needs your attention</Text>
      {brief.findings.map(({session, finding}, index) => <View key={`finding-${index}`} style={{padding: 12, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, borderRadius: 8, gap: 7}}>
        <Text style={{...text, fontSize: 13, fontWeight: "700"}}>{finding.title}</Text><Text style={text}>{finding.action}</Text><Text style={muted}>{name(session)}</Text>{open(session.id, "Review concern")}
      </View>)}
      {brief.needsDecision.map(({session, request}, index) => <View key={`decision-${index}`} style={{padding: 12, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border, borderRadius: 8, gap: 7}}>
        <Text style={{...text, fontSize: 13, fontWeight: "600"}}>{request.question}</Text><Text style={muted}>{name(session)}</Text>{open(session.id, "Open decision")}
      </View>)}
    </View>}
    <View style={{gap: 8}}>
      {!enabled && <Text style={heading}>Last known work</Text>}
      {brief.workspaces.length === 0 && <Text style={muted}>No work sessions in this project.</Text>}
      {brief.workspaces.map(workspace => <View key={workspace.id} style={{flexDirection: layout.compact ? "column" : "row", overflow: "hidden", borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: c.surface0}}>
        <View style={{padding: 10, backgroundColor: c.surface1, ...(layout.compact ? {} : {width: 190, flexShrink: 0})}}>
          <Text numberOfLines={layout.compact ? 2 : 3} style={{...text, fontSize: 13, fontWeight: "600"}}>{workspace.title}</Text>
        </View>
        <View style={{...(layout.compact ? {} : {flex: 1, minWidth: 0}), padding: 10, gap: 0}}>
        {(expanded.includes(workspace.id) ? workspace.owners : workspace.owners.slice(0, 2)).map((session, index) => <Pressable key={session.id} accessibilityRole="button" accessibilityLabel={`Open ${name(session)}`} onPress={() => onSession(session.id)} style={{gap: 3, ...(index ? {paddingTop: 8, marginTop: 8, borderTopWidth: 1, borderColor: c.border} : {})}}>
          <View style={{flexDirection: "row", gap: 10, alignItems: "flex-start", justifyContent: "space-between"}}><Text style={{...text, fontSize: 13, flex: 1, fontWeight: "600"}}>{name(session)}</Text><Text style={{...muted, fontSize: 10, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: c.surface1, borderRadius: 4}}>{session.status === "not watched" ? "Not watched" : session.error ? "Review failed" : session.pendingCount ? "Pending" : session.status === "running" ? "Working" : "Idle"}</Text></View>
          <Text numberOfLines={2} style={text}>{session.analysis?.purpose ?? "Purpose has not been reviewed yet."}</Text>
          {session.analysis?.nextAction && <Text numberOfLines={2} style={muted}>Next: {session.analysis.nextAction}</Text>}
        </Pressable>)}
        {workspace.owners.length > 2 && <Pressable accessibilityRole="button" onPress={() => setExpanded(expanded.includes(workspace.id) ? expanded.filter(id => id !== workspace.id) : [...expanded, workspace.id])} style={{paddingTop: 7}}><Text style={muted}>{expanded.includes(workspace.id) ? "Show fewer" : `Show ${workspace.owners.length - 2} more sessions`}</Text></Pressable>}
        </View>
      </View>)}
    </View>
    <View style={{gap: 8, backgroundColor: c.surface1, padding: 12, borderRadius: 8}}>
      <Text style={heading}>Latest reviewed changes</Text>
      {brief.recent.length === 0 && <Text style={muted}>No changes recorded yet.</Text>}
      {brief.recent.map(session => <View key={session.id} style={{gap: 4, paddingBottom: 10, borderBottomWidth: 1, borderColor: c.border}}><Text numberOfLines={2} style={text}>{session.analysis!.recentChange}</Text><Text style={muted}>{name(session)} · {new Date(session.lastActivityAt!).toLocaleString()}</Text></View>)}
    </View>
    {brief.inboxCount > 0 && <Pressable accessibilityRole="button" onPress={() => {if (projectId) onInbox(projectId);}} style={{alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.surface2, borderRadius: 8}}><Text style={{...text, fontSize: 13, fontWeight: "600"}}>View {brief.inboxCount} inbox {brief.inboxCount === 1 ? "session" : "sessions"}</Text></Pressable>}
  </View>;
}
