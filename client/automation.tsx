import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { Switch, Text, View } from "react-native";
import { preferences, type Settings } from "../shared/contracts";

export function AutomationControls({theme, onSaved}: Pick<PluginSurfaceProps, "theme"> & {onSaved(): void}) {
  const settings = useSettings(preferences);
  if (settings.status !== "ready") return <Text style={{color: theme.colors.foregroundMuted}}>Automation controls unavailable</Text>;
  const toggle = (key: "enabled" | "autoName" | "autoNameWorkspaces", label: string) => <View key={key} style={{flex: 1, minWidth: 200, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingVertical: 12}}>
    <Text style={{color: theme.colors.foreground, fontSize: 15, fontWeight: "600"}}>{label}</Text>
    <Switch accessibilityLabel={label} disabled={settings.saving} value={settings.values[key]} onValueChange={value => {
      void settings.save({...settings.values, [key]: value} as Settings, settings.revision).then(onSaved).catch(() => {});
    }} trackColor={{false: theme.colors.surface2, true: theme.colors.foreground}} thumbColor={theme.colors.surface0} ios_backgroundColor={theme.colors.surface2} />
  </View>;
  return <View style={{gap: 8, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.border}}>
    <Text style={{color: theme.colors.foregroundMuted, fontSize: 13}}>Automation for all watched projects</Text>
    <View style={{flexDirection: "row", flexWrap: "wrap", columnGap: 32}}>{toggle("enabled", "Watch sessions")}{toggle("autoName", "Name tabs")}{toggle("autoNameWorkspaces", "Name workspaces")}</View>
    {settings.saveError && <Text accessibilityRole="alert" style={{color: theme.colors.foreground}}>{settings.saveError}</Text>}
  </View>;
}
