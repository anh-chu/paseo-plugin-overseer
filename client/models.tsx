import {usePaseo, useSettings} from "@getpaseo/plugin/client";
import type {PluginSurfaceProps} from "@getpaseo/plugin/client";
import {useQuery} from "@tanstack/react-query";
import {useState} from "react";
import {Pressable, Text, View} from "react-native";
import {preferences} from "../shared/contracts";

export function ModelPicker({theme, host}: Pick<PluginSurfaceProps, "theme" | "host">) {
  const paseo = usePaseo(), settings = useSettings(preferences);
  const [open, setOpen] = useState(false), [provider, setProvider] = useState<string | null>(null);
  const catalog = useQuery({queryKey: ["overseer-providers", host.id], queryFn: () => paseo.providers.waitForReady({}), refetchInterval: 15000});
  const selection = settings.status === "ready" ? settings.values.providerModel ?? `codex/${settings.values.codexModel}` : "";
  const slash = selection.indexOf("/"), selectedProvider = selection.slice(0, slash), selectedModel = selection.slice(slash + 1);
  const providers = catalog.data?.entries.filter(entry => entry.enabled && entry.status === "ready") ?? [];
  const activeProvider = (providers.some(entry => entry.provider === provider) ? provider : null) ?? (providers.some(entry => entry.provider === selectedProvider) ? selectedProvider : providers[0]?.provider);
  const models = useQuery({queryKey: ["overseer-models", host.id, activeProvider], queryFn: () => paseo.providers.listModels(activeProvider!), enabled: open && !!activeProvider, refetchInterval: open ? 15000 : false});
  if (settings.status !== "ready") return null;
  const c = theme.colors;
  const button = {padding: 10, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1};
  return <View style={{gap: 8}}>
    <Text style={{color: c.foreground, fontSize: 14, fontWeight: "600"}}>Review model</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Choose review model" accessibilityState={{expanded: open}} onPress={() => setOpen(!open)} style={button}>
      <Text style={{color: c.foreground, fontSize: 13}}>{providers.find(entry => entry.provider === selectedProvider)?.label ?? selectedProvider} / {selectedModel}</Text>
    </Pressable>
    {catalog.data && !providers.some(entry => entry.provider === selectedProvider) && <Text accessibilityRole="alert" style={{color: c.foregroundMuted}}>The selected provider is unavailable. Choose an enabled provider.</Text>}
    {(catalog.error || models.error) && <Text accessibilityRole="alert" style={{color: c.foreground}}>{(catalog.error ?? models.error)?.message}</Text>}
    {open && <View style={{gap: 8}}>
      {catalog.isPending && <Text style={{color: c.foregroundMuted}}>Loading providers…</Text>}
      {catalog.data && !providers.length && <Text style={{color: c.foregroundMuted}}>Enable a provider in Paseo settings.</Text>}
      <View style={{flexDirection: "row", flexWrap: "wrap", gap: 6}}>{providers.map(entry => <Pressable key={entry.provider} accessibilityRole="button" accessibilityState={{selected: activeProvider === entry.provider}} onPress={() => setProvider(entry.provider)} style={{...button, backgroundColor: activeProvider === entry.provider ? c.surface2 : c.surface0}}>
        <Text style={{color: c.foreground, fontSize: 12, fontWeight: activeProvider === entry.provider ? "700" : "400"}}>{entry.label ?? entry.provider}</Text>
      </Pressable>)}</View>
      {models.isPending && activeProvider && <Text style={{color: c.foregroundMuted}}>Loading models…</Text>}
      {models.data?.error && <Text accessibilityRole="alert" style={{color: c.foreground}}>{models.data.error}</Text>}
      {models.data && !models.data.models?.length && <Text style={{color: c.foregroundMuted}}>This provider returned no models.</Text>}
      {models.data?.models?.filter(model => model.isSelectable !== false).map(model => <Pressable key={model.id} accessibilityRole="radio" accessibilityLabel={model.label} accessibilityState={{checked: selection === `${activeProvider}/${model.id}`, disabled: settings.saving}}
        disabled={settings.saving} onPress={() => {
          void settings.save({...settings.values, providerModel: `${activeProvider}/${model.id}`}, settings.revision).then(() => setOpen(false)).catch(() => {});
        }} style={{...button, flexDirection: "row", justifyContent: "space-between", gap: 8}}>
        <Text style={{color: c.foreground, fontSize: 13, flex: 1}}>{model.label}</Text>
        {selection === `${activeProvider}/${model.id}` && <Text style={{color: c.foregroundMuted, fontSize: 12}}>Selected</Text>}
      </Pressable>)}
    </View>}
    {settings.saveError && <Text accessibilityRole="alert" style={{color: c.foreground}}>{settings.saveError}</Text>}
  </View>;
}
