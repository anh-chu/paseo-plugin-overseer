import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Text } from "react-native";
import { statusRpc, findingKey } from "./shared/contracts";
import { OverseerScreen, OverseerSettings } from "./client/overseer";

function OverseerItem({ currentScreen, openScreen, theme, host, client }: PluginSidebarItemProps & {client: PluginClientContext}) {
  const status = useRpc(statusRpc);
  const query = useQuery({queryKey: ["overseer", host.id], queryFn: () => status({}), refetchInterval: 8000});
  const pills = useRef(new Map<string, ReturnType<PluginClientContext["addComposerPill"]>>());
  const sessions = query.data?.sessions ?? [];
  const concerns = sessions.reduce((count, session) => count + (session.analysis?.findings.filter(finding => !query.data?.dismissed.includes(findingKey(session.id, finding))).length ?? 0), 0);
  useEffect(() => {
    const active = new Set<string>();
    for (const session of query.data?.sessions ?? []) {
      const count = session.analysis?.findings.filter(finding => !query.data?.dismissed.includes(findingKey(session.id, finding))).length ?? 0;
      if (!count || session.status === "not watched") continue;
      active.add(session.id);
      const button = {title: "Review session concerns", icon: "ScanEye", label: `${count} ${count === 1 ? "concern" : "concerns"}`,
        behavior: {kind: "action" as const, onPress: () => client.openScreen({screenId: "overseer", params: {sessionId: session.id}})}};
      const existing = pills.current.get(session.id);
      if (existing) existing.update(button);
      else pills.current.set(session.id, client.addComposerPill({id: "concerns", workspaceId: session.workspaceId, agentId: session.id, button}));
    }
    for (const [id, registration] of pills.current) if (!active.has(id)) {registration.remove(); pills.current.delete(id);}
  }, [query.data, client]);
  useEffect(() => () => { for (const registration of pills.current.values()) registration.remove(); pills.current.clear(); }, []);
  return (
    <SidebarRow
      icon="ScanEye"
      active={currentScreen?.screenId === "overseer"}
      onPress={() => openScreen({ screenId: "overseer" })}
      trailing={concerns ? <Text style={{color: theme.colors.foreground, fontWeight: "700", paddingHorizontal: 8}}>{concerns}</Text> : undefined}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "overseer", title: "Overseer", Component: OverseerScreen });
  client.addSidebarHeaderItem({ id: "overseer", title: "Overseer", Component: props => <OverseerItem {...props} client={client} /> });
  client.addSettingsScreen({ id: "overseer", title: "Overseer", icon: "ScanEye", Component: OverseerSettings });
  client.addWorkspacePanel({ id: "overseer", title: "Overseer", icon: "ScanEye", Component: props => <OverseerScreen {...props} params={{workspaceId: props.workspaceId}} /> });
  client.addCommandCenterItem({id: "open-overseer", title: "Open project overseer", icon: "ScanEye", context: "global", onSelect: ({openScreen}) => openScreen({screenId: "overseer"})});
  return () => {};
}
