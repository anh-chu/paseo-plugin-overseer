import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { preferences, statusRpc, actionRpc } from "./shared/contracts";
import { connectBridgeDaemon } from "./server/connection";
import { Store } from "./server/store";
import { providerExecutor } from "./server/provider";
import { Luna } from "./server/model";
import { Observer } from "./server/observer";
import { UsageLedger } from "./server/usage";
import { usageRpc } from "./shared/usage";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  const home = process.env.PASEO_HOME?.trim() || join(homedir(), ".paseo");
  const directory = join(home, "plugin-data", "overseer");
  const usage = new UsageLedger(directory);
  let usageReady = false;
  let observer: Observer | null = null;
  let connection: Awaited<ReturnType<typeof connectBridgeDaemon>> | null = null;
  let stopped = false;
  let error: string | null = null;
  const ready = (async () => {
    const current = await settings.read();
    if (current.status !== "ready") throw new Error("Overseer settings are invalid");
    await usage.load(); usageReady = true;
    connection = await connectBridgeDaemon();
    if (stopped) { await connection.close(); return; }
    observer = new Observer(connection.paseo, new Store(directory), new Luna(join(directory, "helper"), usage, undefined, providerExecutor(connection.paseo, join(directory, "helper"), connection.createHelper)), current.values, home);
    await observer.start();
    console.info("Overseer is watching selected projects via Paseo providers");
  })().catch(failure => { error = failure instanceof Error ? failure.message : "Overseer could not start"; console.error(error); });
  const offSettings = settings.subscribe(async current => {
    await ready;
    if (current.status === "ready" && !stopped) await observer?.updateSettings(current.values);
  });
  server.handle(statusRpc, async () => {
    await ready;
    return { sessions: Object.values(observer?.store.state.sessions ?? {}).map(({ pending, recent, anchors, fingerprints, ...session }) => ({ ...session, pendingCount: pending.length, workspaceNameLocked: observer!.workspaceNameLocked(session.workspaceId, session.workspaceTitle) })), enabled: observer?.settings.enabled ?? false,
      autoName: observer?.settings.autoName ?? false, autoNameWorkspaces: observer?.settings.autoNameWorkspaces ?? false, busy: observer?.busy ?? null,
      error: error ?? observer?.error ?? null, dismissed: observer?.store.state.dismissed ?? [] };
  });
  server.handle(usageRpc, async ({period}) => {
    await ready;
    if (!usageReady) throw new Error(error ?? "Usage is unavailable");
    return usage.report(period);
  });
  server.handle(actionRpc, async input => {
    await ready;
    if (!observer || error) throw new Error(error ?? "Observer is unavailable");
    const session = observer.store.state.sessions[input.sessionId];
    if (!session) throw new Error("Unknown session");
    if (input.action === "review") await observer.review(input.sessionId);
    else if (input.action === "rename" || input.action === "renameWorkspace") await observer.rename(input.sessionId, input.action === "renameWorkspace");
    else if (input.action === "lock") { session.nameLocked = !session.nameLocked; await observer.store.save(); }
    else if (input.action === "lockWorkspace") await observer.toggleWorkspaceNameLock(input.sessionId);
    else if (input.action === "dismiss" && input.findingKey) {
      observer.store.state.dismissed = [...new Set([...observer.store.state.dismissed, input.findingKey])].slice(-500);
      await observer.store.save();
    }
    return { ok: true };
  });
  return async () => {
    stopped = true; offSettings(); await ready;
    try { await observer?.stop(); await usage.flush(); }
    finally { await connection?.close(); }
  };
}
