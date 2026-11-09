import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import { preferences, type Settings } from "../shared/contracts";

export function AutomationControls({theme, onSaved}: Pick<PluginSurfaceProps, "theme"> & {onSaved(): void}) {
  const settings = useSettings(preferences);
  if (settings.status !== "ready") return <Text style={{color: theme.colors.foregroundMuted}}>Automation controls unavailable</Text>;
  const toggle = (key: "enabled" | "autoName" | "autoNameWorkspaces", label: string, accessibleLabel: string) => <Pressable key={key}
    accessibilityRole="switch" accessibilityLabel={accessibleLabel} accessibilityHint="Applies to all watched projects" accessibilityState={{checked: settings.values[key], disabled: settings.saving}}
    aria-checked={settings.values[key]} aria-disabled={settings.saving}
    disabled={settings.saving} onPress={() => {
      void settings.save({...settings.values, [key]: !settings.values[key]} as Settings, settings.revision).then(onSaved).catch(() => {});
    }} style={{flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 5, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface0, opacity: settings.saving ? 0.5 : 1}}>
    <Text style={{color: theme.colors.foreground, fontSize: 11, fontWeight: "600"}}>{label}</Text>
    <Text style={{color: theme.colors.foregroundMuted, fontSize: 11}}>{settings.values[key] ? "On" : "Off"}</Text>
  </Pressable>;
  return <View style={{gap: 6}}>
    <View style={{flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6}}>
      {settings.values.projectNames.length + settings.values.projectIds.length > 1 && <Text style={{color: theme.colors.foregroundMuted, fontSize: 12, marginRight: 4}}>All projects</Text>}
      {toggle("enabled", "Watch", "Watch sessions")}{toggle("autoName", "Tab names", "Name tabs")}{toggle("autoNameWorkspaces", "Workspace names", "Name workspaces")}
    </View>
    {settings.saveError && <Text accessibilityRole="alert" style={{color: theme.colors.foreground}}>{settings.saveError}</Text>}
  </View>;
}
