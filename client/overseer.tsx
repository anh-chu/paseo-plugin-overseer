import type { PluginScreenProps, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { actionRpc, findingKey, preferences, statusRpc, type SessionView } from "../shared/contracts";
import { UsagePanel } from "./usage";

export function OverseerScreen({ theme, layout, navigation, host, params }: PluginScreenProps) {
  const status = useRpc(statusRpc), act = useRpc(actionRpc);
  const query = useQuery({ queryKey: ["overseer", host.id], queryFn: () => status({}), refetchInterval: 4000 });
  const mutation = useMutation({ mutationFn: act, onSuccess: () => query.refetch() });
  const [selected, setSelected] = useState<string | null>(params.sessionId ?? null);
  useEffect(() => { if (params.sessionId) setSelected(params.sessionId); }, [params.sessionId]);
  const [showEvidence, setShowEvidence] = useState<string | null>(null);
  const [onlyConcerns, setOnlyConcerns] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [view, setView] = useState<"sessions" | "usage">(params.view === "usage" ? "usage" : "sessions");
  useEffect(() => { if (params.view === "usage") setView("usage"); }, [params.view]);
  const colors = theme.colors;
  const text = { color: colors.foreground, fontSize: 15 };
  const muted = { color: colors.foregroundMuted, fontSize: 13 };
  const sessions = (query.data?.sessions ?? []).filter(session => !params.workspaceId || session.workspaceId === params.workspaceId);
  const visibleFindings = (session: SessionView) => (session.analysis?.findings ?? []).filter(finding => !query.data?.dismissed.includes(findingKey(session.id, finding)));
  const concerns = sessions.reduce((count, session) => count + visibleFindings(session).length, 0);
  const current = sessions.find(session => session.id === selected);
  const groups = Object.entries(sessions.filter(session => !onlyConcerns || visibleFindings(session).length).reduce<Record<string, SessionView[]>>((result, session) => {
    (result[session.workspaceId] ??= []).push(session); return result;
  }, {})).sort(([,a], [,b]) => Number(b.some(session => session.status === "running")) - Number(a.some(session => session.status === "running")));
  const button = (label: string, onPress: () => void, strong = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} disabled={mutation.isPending}
    onPress={onPress} style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 8, backgroundColor: strong ? colors.foreground : colors.surface2, opacity: mutation.isPending ? 0.5 : 1 }}>
    <Text style={{ ...text, fontSize: 13, fontWeight: "600", color: strong ? colors.surface0 : colors.foreground }}>{label}</Text>
  </Pressable>;
  const action = (session: SessionView, kind: "review" | "rename" | "renameWorkspace" | "lock" | "lockWorkspace") => mutation.mutate({ sessionId: session.id, action: kind });
  return <ScrollView style={{ flex: 1, backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 32, gap: 24, maxWidth: 1120, width: "100%", alignSelf: "center" }}>
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <Text style={{ ...text, fontSize: layout.compact ? 28 : 36, fontWeight: "700", letterSpacing: -1 }}>Overseer</Text>
      <Text style={muted}>{query.data?.enabled ? `${sessions.filter(session => session.status !== "not watched").length} sessions watched` : "Paused"}{query.data?.busy ? " · Reviewing activity" : ""}</Text>
    </View>
    <View style={{flexDirection: "row", gap: 8}}>
      {button("Sessions", () => setView("sessions"), view === "sessions")}
      {button("Usage", () => setView("usage"), view === "usage")}
    </View>
    {view === "usage" ? <UsagePanel theme={theme} host={host} layout={layout} navigation={navigation} /> : <>
    {(query.error || query.data?.error || mutation.error) && <Text accessibilityRole="alert" style={text}>{(mutation.error ?? query.error)?.message ?? query.data?.error}</Text>}
    {query.isPending && <ActivityIndicator color={colors.foreground} />}
    {!query.isPending && !sessions.length && <View style={{ gap: 12 }}><Text style={text}>No sessions in the selected projects.</Text><Text style={muted}>Choose projects in Settings → Plugins → Overseer.</Text></View>}
    {sessions.length > 0 && !current && <>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {button("All sessions", () => setOnlyConcerns(false), !onlyConcerns)}
        {button(`${concerns} concerns`, () => setOnlyConcerns(true), onlyConcerns)}
      </View>
      {groups.map(([workspaceId, entries]) => <View key={workspaceId} style={{gap: 4}}>
        <Text style={{...text, fontWeight: "700", fontSize: 20, marginTop: 8}}>{entries[0].workspaceTitle}</Text>
        {(expanded.includes(workspaceId) || onlyConcerns ? entries : entries.slice(0, 3)).map(session => <Pressable key={session.id}
        accessibilityRole="button" accessibilityLabel={`Review ${session.analysis?.suggestedName ?? session.title}`}
        onPress={() => setSelected(session.id)} style={{ paddingVertical: 18, borderBottomWidth: 1, borderColor: colors.border, gap: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}>
          <Text style={{ ...text, flex: 1, fontWeight: "600", fontSize: 18 }}>{session.analysis?.suggestedName ?? session.title}</Text>
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
        <Text style={{ ...text, fontSize: 26, fontWeight: "700" }}>{current.analysis?.suggestedName ?? current.title}</Text>
        <Text style={muted}>{current.projectName} / {current.workspaceTitle}</Text>
        {current.analysis && <Text style={{ ...text, fontSize: 17, lineHeight: 26 }}>{current.analysis.purpose}</Text>}
        <Text style={muted}>{current.coverage === "partial" ? "Earlier history is incomplete. Watching new activity." : current.coverage === "recovering" ? "Recovering missed activity." : "Following session activity."}{current.pendingCount ? ` ${current.pendingCount} updates await review.` : ""}</Text>
        {current.error && <Text accessibilityRole="alert" style={text}>{current.error}</Text>}
      </View>
      {visibleFindings(current).map(finding => {
        const key = findingKey(current.id, finding);
        return <View key={key} style={{ backgroundColor: colors.surface1, padding: 20, borderRadius: 12, gap: 12 }}>
          <Text style={{ ...text, fontWeight: "700", fontSize: 18 }}>{finding.title}</Text>
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
        <View style={{ gap: 10 }}><Text style={{ ...text, fontSize: 18, fontWeight: "700" }}>Agreed scope</Text>{current.analysis.scope.map((scope, index) => <Text key={index} style={text}>{scope}</Text>)}</View>
        {current.analysis.decisions.length > 0 && <View style={{ gap: 10 }}><Text style={{ ...text, fontSize: 18, fontWeight: "700" }}>Decisions</Text>{current.analysis.decisions.map((decision, index) => <Text key={index} style={text}>{decision}</Text>)}</View>}
        {current.analysis.nextAction && <View style={{ gap: 10 }}><Text style={{ ...text, fontSize: 18, fontWeight: "700" }}>Next action</Text><Text style={text}>{current.analysis.nextAction}</Text></View>}
        <View style={{ gap: 14, paddingVertical: 20, borderTopWidth: 1, borderColor: colors.border }}>
          <Text style={{ ...text, fontSize: 18, fontWeight: "700" }}>Names</Text>
          <Text style={muted}>Current tab: {current.title}</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {current.title !== current.analysis.suggestedName && button(`Use “${current.analysis.suggestedName}”`, () => action(current, "rename"))}
            {button(current.nameLocked ? "Allow automatic tab naming" : "Keep tab name", () => action(current, "lock"))}
          </View>
          <Text style={muted}>Current workspace: {current.workspaceTitle}</Text>
          <View style={{flexDirection: "row", gap: 8, flexWrap: "wrap"}}>
            {current.workspaceTitle !== current.analysis.workspaceName && button(`Name workspace “${current.analysis.workspaceName}”`, () => action(current, "renameWorkspace"))}
            {button(current.workspaceNameLocked ? "Allow automatic workspace naming" : "Keep workspace name", () => action(current, "lockWorkspace"))}
          </View>
        </View>
      </>}
    </>}
    </>}
  </ScrollView>;
}

export function OverseerSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  const [projects, setProjects] = useState<string | null>(null);
  if (settings.status !== "ready") return <Text style={{ color: theme.colors.foreground }}>Loading settings…</Text>;
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 24 }}>
    <SettingsSection title="Observation"><SettingsCard>
      <SettingsSwitch label="Watch sessions" disabled={settings.saving} value={settings.values.enabled} onValueChange={enabled => { void settings.save({...settings.values, enabled}, settings.revision); }} />
    </SettingsCard></SettingsSection>
    <View style={{gap: 12}}>
      <Text style={{color: theme.colors.foreground, fontSize: 16, fontWeight: "600"}}>Projects</Text>
      <TextInput accessibilityLabel="Projects to watch" value={projects ?? settings.values.projectNames.join(", ")} onChangeText={setProjects} style={{color: theme.colors.foreground, backgroundColor: theme.colors.surface1, padding: 12, borderRadius: 8}} />
      <Pressable accessibilityRole="button" disabled={settings.saving || projects === null} onPress={() => { void settings.save({...settings.values, projectNames: (projects ?? "").split(",").map(name => name.trim()).filter(Boolean)}, settings.revision); }} style={{alignSelf: "flex-start", padding: 12, borderRadius: 8, backgroundColor: theme.colors.surface2, opacity: settings.saving || projects === null ? 0.5 : 1}}><Text style={{color: theme.colors.foreground}}>Save projects</Text></Pressable>
    </View>
    <SettingsSection title="Names"><SettingsCard>
      <SettingsSwitch label="Automatically name generic tabs" disabled={settings.saving} value={settings.values.autoName} onValueChange={autoName => { void settings.save({...settings.values, autoName}, settings.revision); }} />
      <SettingsSwitch label="Automatically name workspaces" disabled={settings.saving} value={settings.values.autoNameWorkspaces} onValueChange={autoNameWorkspaces => { void settings.save({...settings.values, autoNameWorkspaces}, settings.revision); }} />
    </SettingsCard></SettingsSection>
    {settings.saveError && <Text style={{color: theme.colors.foreground}}>{settings.saveError}</Text>}
    <Text style={{color: theme.colors.foregroundMuted}}>gpt-6-luna via Codex. Uses the daemon’s existing Codex login. Activity is sent to Codex for analysis. Other naming plugins remain enabled; manual names are preserved.</Text>
  </ScrollView>;
}
