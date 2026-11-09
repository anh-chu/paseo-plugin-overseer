import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { SessionView } from "../shared/contracts";
import { projectBrief } from "../shared/brief";

export function ProjectBrief({theme, sessions, dismissed, enabled, onSession, onInbox}: Pick<PluginSurfaceProps, "theme"> & {
  sessions: SessionView[]; dismissed: string[]; enabled: boolean; onSession(id: string): void; onInbox(projectId: string): void;
}) {
  const projects = [...new Map(sessions.map(session => [session.projectId, session.projectName])).entries()];
  const [selected, setSelected] = useState<string | null>(null);
  const projectId = selected && projects.some(([id]) => id === selected) ? selected : projects[0]?.[0];
  const rows = sessions.filter(session => session.projectId === projectId);
  const brief = projectBrief(rows, dismissed, !enabled);
  const c = theme.colors;
  const text = {color: c.foreground, fontSize: 15};
  const muted = {color: c.foregroundMuted, fontSize: 13};
  const heading = {color: c.foreground, fontSize: 21, fontWeight: "700" as const};
  const name = (session: SessionView) => session.analysis?.suggestedName ?? session.title;
  const open = (id: string, label: string) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onSession(id)} style={{alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 10, backgroundColor: c.surface2, borderRadius: 8}}><Text style={{...text, fontSize: 13, fontWeight: "600"}}>{label}</Text></Pressable>;
  return <View style={{gap: 28}}>
    {projects.length > 1 && <View style={{flexDirection: "row", gap: 8, flexWrap: "wrap"}}>{projects.map(([id, title]) => <Pressable key={id} accessibilityRole="button" onPress={() => setSelected(id)} style={{padding: 12, borderRadius: 8, backgroundColor: id === projectId ? c.foreground : c.surface2}}><Text style={{...text, color: id === projectId ? c.surface0 : c.foreground}}>{title}</Text></Pressable>)}</View>}
    <View style={{gap: 8}}>
      <Text style={{...heading, fontSize: 28}}>{projects.find(([id]) => id === projectId)?.[1] ?? "Project brief"}</Text>
      <Text style={text}>{!enabled ? "Watching paused" : brief.failedCount ? `${brief.failedCount} ${brief.failedCount === 1 ? "review needs" : "reviews need"} attention` : brief.waitingCount ? `${brief.waitingCount} ${brief.waitingCount === 1 ? "session awaits" : "sessions await"} review` : brief.watchedCount ? "Caught up with observed activity" : "No sessions watched"}</Text>
      {brief.lastReviewedAt && <Text style={muted}>Last reviewed {new Date(brief.lastReviewedAt).toLocaleString()}</Text>}
      {brief.incompleteCount > 0 && <Text style={muted}>Earlier history is incomplete in {brief.incompleteCount} {brief.incompleteCount === 1 ? "session" : "sessions"}.</Text>}
    </View>
    {(brief.findings.length > 0 || brief.needsDecision.length > 0) && <View style={{gap: 16}}>
      <Text style={heading}>Needs your attention</Text>
      {brief.findings.map(({session, finding}, index) => <View key={`finding-${index}`} style={{padding: 18, backgroundColor: c.surface1, borderRadius: 12, gap: 10}}>
        <Text style={{...text, fontSize: 17, fontWeight: "700"}}>{finding.title}</Text><Text style={text}>{finding.action}</Text><Text style={muted}>{name(session)}</Text>{open(session.id, "Review concern")}
      </View>)}
      {brief.needsDecision.map(({session, request}, index) => <View key={`decision-${index}`} style={{padding: 18, backgroundColor: c.surface1, borderRadius: 12, gap: 10}}>
        <Text style={{...text, fontSize: 17, fontWeight: "600"}}>{request.question}</Text><Text style={muted}>{name(session)}</Text>{open(session.id, "Open decision")}
      </View>)}
    </View>}
    <View style={{gap: 18}}>
      <Text style={heading}>{enabled ? "Who owns what" : "Last known work"}</Text>
      {brief.workspaces.length === 0 && <Text style={muted}>No work sessions in this project.</Text>}
      {brief.workspaces.map(workspace => <View key={workspace.id} style={{gap: 14, paddingBottom: 20, borderBottomWidth: 1, borderColor: c.border}}>
        <Text style={{...text, fontSize: 18, fontWeight: "700"}}>{workspace.title}</Text>
        {workspace.owners.map(session => <Pressable key={session.id} accessibilityRole="button" accessibilityLabel={`Open ${name(session)}`} onPress={() => onSession(session.id)} style={{gap: 6, paddingVertical: 6}}>
          <View style={{flexDirection: "row", gap: 16, justifyContent: "space-between"}}><Text style={{...text, flex: 1, fontWeight: "600"}}>{name(session)}</Text><Text style={muted}>{session.status === "not watched" ? "Not watched" : session.error ? "Review failed" : session.pendingCount ? "Review pending" : session.status === "running" ? "Working" : "Idle"}</Text></View>
          <Text style={text}>{session.analysis?.purpose ?? "Purpose has not been reviewed yet."}</Text>
          {session.analysis?.nextAction && <Text style={muted}>Next: {session.analysis.nextAction}</Text>}
        </Pressable>)}
      </View>)}
    </View>
    <View style={{gap: 16}}>
      <Text style={heading}>Latest reviewed changes</Text>
      {brief.recent.length === 0 && <Text style={muted}>No changes recorded yet.</Text>}
      {brief.recent.map(session => <View key={session.id} style={{gap: 7, paddingBottom: 14, borderBottomWidth: 1, borderColor: c.border}}><Text style={text}>{session.analysis!.recentChange}</Text><Text style={muted}>{name(session)} · {new Date(session.lastActivityAt!).toLocaleString()}</Text></View>)}
    </View>
    {brief.inboxCount > 0 && <Pressable accessibilityRole="button" onPress={() => {if (projectId) onInbox(projectId);}} style={{alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.surface2, borderRadius: 8}}><Text style={{...text, fontSize: 13, fontWeight: "600"}}>View {brief.inboxCount} inbox {brief.inboxCount === 1 ? "session" : "sessions"}</Text></Pressable>}
  </View>;
}
