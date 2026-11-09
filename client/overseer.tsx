import type { PluginScreenProps, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { actionRpc, findingKey, preferences, statusRpc, type SessionView } from "../shared/contracts";
import { sampleSessions } from "../shared/sample";
import { ModelPicker } from "./models";
import { ProjectPicker } from "./projects";
import { UsagePanel } from "./usage";
import { AutomationControls } from "./automation";
import { ProjectBrief } from "./brief";

export function OverseerScreen({ theme, layout, navigation, host, params }: PluginScreenProps) {
  const sample = params.preview === "sample";
  const status = useRpc(statusRpc), act = useRpc(actionRpc);
  const settings = useSettings(preferences);
  const query = useQuery({ queryKey: ["overseer", host.id], queryFn: () => status({}), enabled: !sample, refetchInterval: 4000 });
  const mutation = useMutation({ mutationFn: act, onSuccess: () => query.refetch() });
  const [selected, setSelected] = useState<string | null>(params.sessionId ?? null);
  const [showEvidence, setShowEvidence] = useState<string | null>(null);
  const [onlyConcerns, setOnlyConcerns] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [inboxProject, setInboxProject] = useState<string | null>(null);
  const [view, setView] = useState<"brief" | "sessions" | "usage">(params.view === "usage" ? "usage" : params.sessionId ? "sessions" : "brief");
  useEffect(() => { if (params.sessionId) {setSelected(params.sessionId); setView("sessions");} }, [params.sessionId]);
  useEffect(() => { if (params.view === "usage") setView("usage"); }, [params.view]);
  const colors = theme.colors;
  const text = { color: colors.foreground, fontSize: 13 };
  const muted = { color: colors.foregroundMuted, fontSize: 11 };
  const sessions = (sample ? sampleSessions : query.data?.sessions ?? []).filter(session => !params.workspaceId || session.workspaceId === params.workspaceId);
  const visibleFindings = (session: SessionView) => (session.analysis?.findings ?? []).filter(finding => !query.data?.dismissed.includes(findingKey(session.id, finding)));
  const concerns = sessions.reduce((count, session) => count + visibleFindings(session).length, 0);
  const current = sessions.find(session => session.id === selected);
  const groups = Object.entries(sessions.filter(session => (!onlyConcerns || visibleFindings(session).length) && (!inboxProject || session.kind === "inbox" && session.projectId === inboxProject)).reduce<Record<string, SessionView[]>>((result, session) => {
    (result[session.workspaceId] ??= []).push(session); return result;
  }, {})).sort(([,a], [,b]) => Number(b.some(session => session.status === "running")) - Number(a.some(session => session.status === "running")));
  const button = (label: string, onPress: () => void, strong = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} disabled={mutation.isPending}
    onPress={onPress} style={{ paddingHorizontal: 9, paddingVertical: 6, borderRadius: 5, backgroundColor: strong ? colors.foreground : colors.surface2, opacity: mutation.isPending ? 0.5 : 1 }}>
    <Text style={{ ...text, fontSize: 12, fontWeight: "600", color: strong ? colors.surface0 : colors.foreground }}>{label}</Text>
  </Pressable>;
  const action = (session: SessionView, kind: "review" | "rename" | "renameWorkspace" | "lock" | "lockWorkspace") => mutation.mutate({ sessionId: session.id, action: kind });
  if (sample) return <ScrollView style={{flex: 1, backgroundColor: colors.surface0}} contentContainerStyle={{padding: layout.compact ? 10 : 16, gap: 12, maxWidth: 1200, width: "100%", alignSelf: "center"}}>
    <Text style={{...muted, fontWeight: "600"}}>Sample data</Text>
    <ProjectBrief theme={theme} layout={layout} sessions={sampleSessions} dismissed={[]} enabled onSession={() => {}} onInbox={() => {}} />
  </ScrollView>;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 10 : 16, gap: 12, maxWidth: 1200, width: "100%", alignSelf: "center" }}>
    <View style={{gap: 7, padding: 8, backgroundColor: colors.surface1, borderWidth: 1, borderColor: colors.border, borderRadius: 8}}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
    <View style={{flexDirection: "row", gap: 6}}>
      {button("Brief", () => setView("brief"), view === "brief")}
      {button("Sessions", () => setView("sessions"), view === "sessions")}
      {button("Usage", () => setView("usage"), view === "usage")}
    </View>
      <Text style={muted}>{query.data?.enabled ? `${sessions.filter(session => session.status !== "not watched").length} watched` : "Paused"}{query.data?.busy ? " · Reviewing" : ""}</Text>
    </View>
    <AutomationControls theme={theme} onSaved={() => { void query.refetch(); }} />
    </View>
    {settings.status === "ready" && !settings.values.projectIds.length && !settings.values.projectNames.length && <View style={{gap: 16}}><ModelPicker theme={theme} host={host} /><ProjectPicker theme={theme} host={host} /></View>}
    {view === "usage" ? <UsagePanel theme={theme} host={host} layout={layout} navigation={navigation} /> : view === "brief" ? <>
      {(query.error || query.data?.error) && <Text accessibilityRole="alert" style={text}>{query.error?.message ?? query.data?.error}</Text>}
      {query.isPending ? <ActivityIndicator color={colors.foreground} /> : <ProjectBrief theme={theme} layout={layout} sessions={sessions} dismissed={query.data?.dismissed ?? []} enabled={query.data?.enabled ?? false}
        onSession={id => {setSelected(id); setView("sessions"); setInboxProject(null);}}
        onInbox={projectId => {setSelected(null); setView("sessions"); setInboxProject(projectId); setOnlyConcerns(false);}} />}
    </> : <>
    {(query.error || query.data?.error || mutation.error) && <Text accessibilityRole="alert" style={text}>{(mutation.error ?? query.error)?.message ?? query.data?.error}</Text>}
    {query.isPending && <ActivityIndicator color={colors.foreground} />}
    {!query.isPending && !sessions.length && <View style={{ gap: 12 }}><Text style={text}>No sessions in the selected projects.</Text><Text style={muted}>Choose projects in Settings → Plugins → Overseer.</Text></View>}
    {sessions.length > 0 && !current && <>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {button("All sessions", () => {setOnlyConcerns(false); setInboxProject(null);}, !onlyConcerns && !inboxProject)}
        {button(`${concerns} concerns`, () => {setOnlyConcerns(true); setInboxProject(null);}, onlyConcerns)}
      </View>
      {inboxProject && <Text style={{...text, fontSize: 16, fontWeight: "700"}}>Inbox · {sessions.find(session => session.projectId === inboxProject)?.projectName}</Text>}
      {groups.map(([workspaceId, entries]) => <View key={workspaceId} style={{gap: 4}}>
        <Text style={{...text, fontWeight: "700", fontSize: 16, marginTop: 8}}>{entries[0].workspaceTitle}</Text>
        {(expanded.includes(workspaceId) || onlyConcerns ? entries : entries.slice(0, 3)).map(session => <Pressable key={session.id}
        accessibilityRole="button" accessibilityLabel={`Review ${session.analysis?.suggestedName ?? session.title}`}
        onPress={() => setSelected(session.id)} style={{ paddingVertical: 18, borderBottomWidth: 1, borderColor: colors.border, gap: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
          <Text style={{ ...text, flex: 1, fontWeight: "600", fontSize: 15 }}>{session.analysis?.suggestedName ?? session.title}</Text>
          <Text style={muted}>{visibleFindings(session).length ? `${visibleFindings(session).length} concerns` : session.error ? "Needs attention" : session.pendingCount ? "Review pending" : session.updatedAt ? "Reviewed" : "Waiting for activity"}</Text>
        </View>
        {session.analysis && <Text style={text}>{session.analysis.purpose}</Text>}
        {session.error && <Text style={muted}>{session.error}</Text>}
      </Pressable>)}
      {entries.length > 3 && !onlyConcerns && <View style={{alignItems: "flex-start", marginTop: 10}}>{button(expanded.includes(workspaceId) ? "Show fewer" : `Show all ${entries.length} sessions`, () => setExpanded(expanded.includes(workspaceId) ? expanded.filter(id => id !== workspaceId) : [...expanded, workspaceId]))}</View>}
      </View>)}
      {onlyConcerns && !concerns && <Text style={text}>No supported concerns in reviewed activity.</Text>}
    </>}
    {current && <>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {button("All sessions", () => setSelected(null))}
        {navigation && button("Open session", () => navigation.openAgent({ agentId: current.id, serverId: host.id }))}
        {button("Review now", () => action(current, "review"))}
      </View>
      <View style={{ gap: 10 }}>
        <Text style={{ ...text, fontSize: 21, fontWeight: "700" }}>{current.analysis?.suggestedName ?? current.title}</Text>
        <Text style={muted}>{current.projectName} / {current.workspaceTitle}</Text>
        {current.analysis && <Text style={{ ...text, fontSize: 14, lineHeight: 21 }}>{current.analysis.purpose}</Text>}
        <Text style={muted}>{current.coverage === "partial" ? "Earlier history is incomplete. Watching new activity." : current.coverage === "recovering" ? "Recovering missed activity." : "Following session activity."}{current.pendingCount ? ` ${current.pendingCount} updates await review.` : ""}</Text>
        {current.error && <Text accessibilityRole="alert" style={text}>{current.error}</Text>}
      </View>
      {visibleFindings(current).map(finding => {
        const key = findingKey(current.id, finding);
        return <View key={key} style={{ backgroundColor: colors.surface1, padding: 20, borderRadius: 12, gap: 12 }}>
          <Text style={{ ...text, fontWeight: "700", fontSize: 15 }}>{finding.title}</Text>
          <Text style={text}>{finding.detail}</Text>
          <Text style={{ ...text, fontWeight: "600" }}>{finding.action}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {button(showEvidence === key ? "Hide evidence" : "Show evidence", () => setShowEvidence(showEvidence === key ? null : key))}
            {finding.otherSessionId && navigation && button("Open related session", () => navigation.openAgent({ agentId: finding.otherSessionId!, serverId: host.id }))}
            {button("Dismiss", () => mutation.mutate({ action: "dismiss", sessionId: current.id, findingKey: key }))}
          </View>
          {showEvidence === key && finding.evidence.map((evidence, index) => <View key={index} style={{ gap: 6, paddingVertical: 8 }}>
            <Text style={muted}>{sessions.find(session => session.id === evidence.sessionId)?.title ?? "Related session"}</Text>
            <Text selectable style={text}>{evidence.quote}</Text>
          </View>)}
        </View>;
      })}
      {current.analysis && <>
        {current.analysis.needsDecision.length > 0 && <View style={{gap: 14}}><Text style={{...text, fontSize: 15, fontWeight: "700"}}>Needs your decision</Text>{current.analysis.needsDecision.map((request, index) => <View key={index} style={{gap: 8}}><Text style={text}>{request.question}</Text><Text selectable style={muted}>{request.evidence.quote}</Text></View>)}</View>}
        <View style={{ gap: 10 }}><Text style={{ ...text, fontSize: 15, fontWeight: "700" }}>Agreed scope</Text>{current.analysis.scope.map((scope, index) => <Text key={index} style={text}>{scope}</Text>)}</View>
        {current.analysis.decisions.length > 0 && <View style={{ gap: 10 }}><Text style={{ ...text, fontSize: 15, fontWeight: "700" }}>Decisions</Text>{current.analysis.decisions.map((decision, index) => <Text key={index} style={text}>{decision}</Text>)}</View>}
        {current.analysis.nextAction && <View style={{ gap: 10 }}><Text style={{ ...text, fontSize: 15, fontWeight: "700" }}>Next action</Text><Text style={text}>{current.analysis.nextAction}</Text></View>}
        <View style={{ gap: 14, paddingVertical: 20, borderTopWidth: 1, borderColor: colors.border }}>
          <Text style={{ ...text, fontSize: 15, fontWeight: "700" }}>Names</Text>
          <Text style={muted}>Current tab: {current.title}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {current.title !== current.analysis.suggestedName && button(`Use “${current.analysis.suggestedName}”`, () => action(current, "rename"))}
            {button(current.nameLocked ? "Allow automatic tab naming" : "Keep tab name", () => action(current, "lock"))}
          </View>
          <Text style={muted}>Current workspace: {current.workspaceTitle}</Text>
          <View style={{flexDirection: "row", gap: 8, flexWrap: "wrap"}}>
            {current.workspaceTitle !== current.analysis.workspaceName && button(`Name workspace “${current.analysis.workspaceName}”`, () => action(current, "renameWorkspace"))}
            {button(current.workspaceNameLocked ? "Unlock workspace name" : "Lock workspace name", () => action(current, "lockWorkspace"))}
          </View>
        </View>
      </>}
    </>}
    </>}
  </ScrollView>;
}

export function OverseerSettings({ theme, host }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  if (settings.status !== "ready") return <Text style={{ color: theme.colors.foreground }}>Loading settings…</Text>;
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 24 }}>
    <SettingsSection title="Observation"><SettingsCard>
      <SettingsSwitch label="Watch sessions" disabled={settings.saving} value={settings.values.enabled} onValueChange={enabled => { void settings.save({...settings.values, enabled}, settings.revision); }} />
    </SettingsCard></SettingsSection>
    <ProjectPicker theme={theme} host={host} />
    <ModelPicker theme={theme} host={host} />
    <SettingsSection title="Names"><SettingsCard>
      <SettingsSwitch label="Automatically name generic tabs" disabled={settings.saving} value={settings.values.autoName} onValueChange={autoName => { void settings.save({...settings.values, autoName}, settings.revision); }} />
      <SettingsSwitch label="Automatically name workspaces" disabled={settings.saving} value={settings.values.autoNameWorkspaces} onValueChange={autoNameWorkspaces => { void settings.save({...settings.values, autoNameWorkspaces}, settings.revision); }} />
    </SettingsCard></SettingsSection>
    {settings.saveError && <Text style={{color: theme.colors.foreground}}>{settings.saveError}</Text>}
    <Text style={{color: theme.colors.foregroundMuted}}>Uses the selected Paseo provider and its configured credentials. Activity is sent to that provider for analysis. Other naming plugins remain enabled; manual names are preserved.</Text>
  </ScrollView>;
}
