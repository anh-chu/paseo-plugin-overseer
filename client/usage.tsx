import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { usageRpc, type UsageMetrics } from "../shared/usage";

const number = (value: number) => Math.round(value).toLocaleString();
const tokens = (metrics: UsageMetrics) => metrics.reportedCalls ? number(metrics.inputTokens + metrics.outputTokens) : metrics.calls ? "Not reported" : "0";
const taskName = (task: string) => task === "workspace_naming" ? "Workspace naming" : "Session reviews";
const callSummary = (metrics: UsageMetrics) => `${number(metrics.calls)} ${metrics.calls === 1 ? "call" : "calls"} · ${tokens(metrics)} tokens`;

export function UsagePanel({theme, host, layout}: PluginSurfaceProps) {
  const [period, setPeriod] = useState<"today" | "week" | "all">("all");
  const read = useRpc(usageRpc);
  const query = useQuery({queryKey: ["overseer-usage", host.id, period], queryFn: () => read({period}), refetchInterval: 4000});
  const c = theme.colors;
  const text = {color: c.foreground, fontSize: 13};
  const muted = {color: c.foregroundMuted, fontSize: 11};
  const data = query.data, total = data?.totals;
  const metric = (label: string, value: string) => <View key={label} style={{flex: 1, minWidth: layout.compact ? 140 : 180, paddingVertical: 18, gap: 8}}>
    <Text style={muted}>{label}</Text><Text selectable style={{...text, fontSize: layout.compact ? 22 : 26, fontWeight: "700", letterSpacing: -0.5}}>{value}</Text>
  </View>;
  const row = (label: string, value: string) => <View key={label} style={{flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 11, borderBottomWidth: 1, borderColor: c.border}}><Text style={{...text, flex: 1}}>{label}</Text><Text selectable style={{...text, fontWeight: "600", flexShrink: 1, textAlign: "right"}}>{value}</Text></View>;
  return <View style={{gap: 24}}>
    <View style={{flexDirection: "row", gap: 8, flexWrap: "wrap"}}>
      {([['today', 'Today (UTC)'], ['week', '7 days'], ['all', 'Since tracking began']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={label} onPress={() => setPeriod(value)} style={{paddingHorizontal: 14, paddingVertical: 11, borderRadius: 8, backgroundColor: period === value ? c.foreground : c.surface2}}><Text style={{...text, fontSize: 12, fontWeight: "600", color: period === value ? c.surface0 : c.foreground}}>{label}</Text></Pressable>)}
    </View>
    {query.isPending && <ActivityIndicator color={c.foreground} />}
    {(query.error || data?.error) && <Text accessibilityRole="alert" style={text}>{query.error?.message ?? data?.error}</Text>}
    {data && total && <>
      <View style={{flexDirection: "row", flexWrap: "wrap", columnGap: 24, borderBottomWidth: 1, borderColor: c.border}}>
        {metric("Reported tokens", tokens(total))}
        {metric("Call attempts", number(total.calls))}
        {metric("Average call time", total.timedCalls ? `${(total.durationMs / total.timedCalls / 1000).toFixed(1)} s` : "—")}
        {metric("Failures", number(total.failed + total.interrupted))}
      </View>
      <View style={{gap: 4}}>
        <Text style={{...text, fontSize: 16, fontWeight: "700", marginBottom: 8}}>Tokens</Text>
        {row("Reported cost (USD)", total.costReportedCalls ? `$${total.costUsd.toFixed(4)} · ${total.costReportedCalls} calls` : "Not reported")}
        {row("Input", total.reportedCalls ? number(total.inputTokens) : "Not reported")}
        {row("Cached input", total.cachedReportedCalls ? number(total.cachedInputTokens) : "Not reported")}
        {row("Output", total.reportedCalls ? number(total.outputTokens) : "Not reported")}
        {row("Reasoning", total.reasoningReportedCalls ? number(total.reasoningTokens) : "Not reported")}
        {row("Input served from cache", total.inputTokens && total.cachedReportedCalls === total.reportedCalls ? `${(100 * total.cachedInputTokens / total.inputTokens).toFixed(1)}%` : "—")}
        <Text style={{...muted, marginTop: 10}}>Cached tokens are part of input. Reasoning tokens are part of output.</Text>
      </View>
      <View style={{gap: 4}}>
        <Text style={{...text, fontSize: 16, fontWeight: "700", marginBottom: 8}}>Calls</Text>
        {row("Completed", number(total.completed))}{row("Running", number(total.running))}{row("Failed", number(total.failed))}
        {row("Canceled", number(total.canceled))}{row("Interrupted", number(total.interrupted))}
        {row("Token reports received", `${number(total.reportedCalls)} / ${number(total.calls - total.running)}`)}
        {row("Activity updates read", number(total.activityCount))}
        {row("Activity payload", `${(total.inputBytes / 1024).toFixed(1)} KiB`)}
        {row("Response output", `${(total.outputBytes / 1024).toFixed(1)} KiB`)}
      </View>
      {data.byProvider.length > 0 && <View style={{gap: 8}}><Text style={{...text, fontSize: 16, fontWeight: "700"}}>By provider</Text>{data.byProvider.map(item => row(item.provider, callSummary(item.metrics)))}</View>}
      {data.byTask.length > 0 && <View style={{gap: 8}}><Text style={{...text, fontSize: 16, fontWeight: "700"}}>By purpose</Text>{data.byTask.map(item => row(taskName(item.task), callSummary(item.metrics)))}</View>}
      {data.byProject.length > 0 && <View style={{gap: 8}}><Text style={{...text, fontSize: 16, fontWeight: "700"}}>By project</Text>{data.byProject.map(item => row(item.projectName, callSummary(item.metrics)))}</View>}
      {data.daily.length > 0 && <View style={{gap: 12}}>
        <Text style={{...text, fontSize: 16, fontWeight: "700"}}>Daily tokens (UTC)</Text>
        {data.daily.map(day => <View key={day.day} style={{gap: 7}}>
          <View style={{flexDirection: "row", justifyContent: "space-between", gap: 16}}><Text style={muted}>{day.day}</Text><Text style={text}>{tokens(day.metrics)}</Text></View>
          <View style={{height: 6, backgroundColor: c.surface2, borderRadius: 3}}><View style={{height: 6, borderRadius: 3, backgroundColor: c.foregroundMuted, width: `${100 * (day.metrics.inputTokens + day.metrics.outputTokens) / Math.max(1, ...data.daily.map(item => item.metrics.inputTokens + item.metrics.outputTokens))}%`}} /></View>
        </View>)}
      </View>}
      {data.recent.length > 0 && <View style={{gap: 12}}><Text style={{...text, fontSize: 16, fontWeight: "700"}}>Recent calls</Text>
        {data.recent.map(call => <View key={call.id} style={{paddingVertical: 14, borderBottomWidth: 1, borderColor: c.border, gap: 7}}>
          <View style={{flexDirection: "row", gap: 12, justifyContent: "space-between"}}><Text style={{...text, fontWeight: "600", flex: 1}}>{taskName(call.task)}</Text><Text style={muted}>{call.status}</Text></View>
          <Text style={text}>{call.task === "workspace_naming" ? call.workspaceName : call.sessionTitle}</Text>
          <Text style={muted}>{call.provider} / {call.model} · {new Date(call.startedAt).toLocaleString()} · {call.tokens ? `${number(call.tokens.inputTokens + call.tokens.outputTokens)} tokens` : "Tokens not reported"} · {call.durationMs !== null ? `${(call.durationMs / 1000).toFixed(1)} s` : call.status === "running" ? "In progress" : "Duration unknown"}</Text>
          {call.error && <Text style={muted}>{call.error}</Text>}
        </View>)}
      </View>}
      <View style={{gap: 8, paddingVertical: 12}}>
        <Text style={muted}>Recording since {new Date(data.startedAt).toLocaleString()}. Earlier calls were not recorded.</Text>
        <Text style={muted}>Usage fields vary by provider. Reported cost is provider metadata, not an account bill.</Text>
      </View>
    </>}
  </View>;
}
