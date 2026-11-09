import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { preferences, watchesProject } from "../shared/contracts";

export function ProjectPicker({theme, host}: Pick<PluginSurfaceProps, "theme" | "host">) {
  const paseo = usePaseo();
  const settings = useSettings(preferences);
  const query = useQuery({queryKey: ["overseer-projects", host.id], queryFn: () => paseo.projects.list()});
  if (settings.status !== "ready") return null;
  return <View style={{gap: 8}}>
    <Text style={{color: theme.colors.foreground, fontSize: 14, fontWeight: "600"}}>Projects to watch</Text>
    {query.isPending && <Text style={{color: theme.colors.foregroundMuted}}>Loading projects…</Text>}
    {query.error && <Text accessibilityRole="alert" style={{color: theme.colors.foreground}}>{query.error.message}</Text>}
    {query.data?.projects.filter(project => !/\/plugin-data\/overseer\/helper\/review-[^/]+$/.test(project.projectRootPath.replace(/\\/g, "/"))).map(project => {
      const selected = watchesProject(settings.values, project.projectId, project.projectDisplayName);
      return <Pressable key={project.projectId} accessibilityRole="checkbox" accessibilityState={{checked: selected, disabled: settings.saving}}
        disabled={settings.saving} onPress={() => {
          // Migrate the old display-name selection to stable IDs when the user edits it.
          const ids = query.data.projects.filter(row => watchesProject(settings.values, row.projectId, row.projectDisplayName)).map(row => row.projectId);
          void settings.save({...settings.values, projectNames: [], projectIds: selected ? ids.filter(id => id !== project.projectId) : [...ids, project.projectId]}, settings.revision).catch(() => {});
        }} style={{flexDirection: "row", justifyContent: "space-between", gap: 12, padding: 10, borderRadius: 6, backgroundColor: theme.colors.surface1}}>
        <Text style={{color: theme.colors.foreground, fontSize: 13}}>{project.projectDisplayName}</Text>
        <Text style={{color: theme.colors.foregroundMuted, fontSize: 12}}>{selected ? "Watching" : "Off"}</Text>
      </Pressable>;
    })}
    {query.data?.projects.length === 0 && <Text style={{color: theme.colors.foregroundMuted}}>Create a Paseo project to start watching.</Text>}
    {settings.saveError && <Text accessibilityRole="alert" style={{color: theme.colors.foreground}}>{settings.saveError}</Text>}
  </View>;
}
