import type { PaseoApi, PaseoAgent, PaseoWorkspace } from "@getpaseo/client";
import type { Settings, Session } from "../shared/contracts";
import { sessionSchema } from "../shared/contracts";
import { batch, checkedAnalysis, genericName, ingest } from "./activity";
import { Luna, executable, run } from "./model";
import { Store } from "./store";

export class Observer {
  readonly lifetime = new AbortController();
  readonly watched = new Map<string, () => void>();
  readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly syncing = new Map<string, Promise<void>>();
  readonly cooldown = new Map<string, number>();
  private cleanups: (() => void | Promise<void>)[] = [];
  private workspaces = new Map<string, PaseoWorkspace>();
  private agents = new Map<string, PaseoAgent>();
  private served = new Map<string, number>();
  private batchNumber = 0;
  private initialized: Promise<void> | null = null;
  private worker: Promise<void> | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  busy: string | null = null;
  error: string | null = null;
  settings: Settings;
  constructor(readonly paseo: PaseoApi, readonly store: Store, readonly luna: Luna, settings: Settings, readonly home: string) { this.settings = settings; }

  start() { return this.initialized ??= this.initialize(); }
  private async initialize() {
    await this.store.load();
    for (const session of Object.values(this.store.state.sessions)) {
      session.status = "not watched";
      if (!session.anchors.length) session.anchors = session.recent.filter(row => row.role === "user_message").slice(-9);
    }
    if (this.lifetime.signal.aborted) return;
    const workspacePage = await this.paseo.workspaces.list({ subscribe: {}, page: { limit: 100 } });
    const acceptWorkspace = (workspace: PaseoWorkspace) => {
      this.workspaces.set(workspace.id, workspace);
      for (const agent of this.agents.values()) if (agent.workspaceId === workspace.id) this.accept(agent);
    };
    const workspaces = [...workspacePage.entries];
    let workspaceCursor = workspacePage.pageInfo.nextCursor;
    while (workspaceCursor) {
      const next = await this.paseo.workspaces.list({ page: { limit: 100, cursor: workspaceCursor } });
      workspaces.push(...next.entries); workspaceCursor = next.pageInfo.nextCursor;
    }
    workspaces.forEach(acceptWorkspace);
    this.cleanups.push(() => workspacePage.subscription.release());
    workspacePage.subscription.subscribe({
      snapshot: page => page.entries.forEach(acceptWorkspace),
      update: message => {
        if (message.type !== "workspace_update") return;
        const update = message.payload;
        if (update.kind === "upsert") acceptWorkspace(update.workspace);
        else {
          this.workspaces.delete(update.id);
          for (const agent of this.agents.values()) if (agent.workspaceId === update.id) this.forget(agent.id);
        }
      },
    });
    const agents = await this.paseo.agents.list({ subscribe: {}, page: { limit: 100 }, sort: [{key: "updated_at", direction: "desc"}] });
    this.cleanups.push(() => agents.subscription.release());
    agents.subscription.subscribe({
      snapshot: page => { for (const entry of page.entries) this.accept(entry.agent); },
      update: message => {
        if (message.type !== "agent_update") return;
        if (message.payload.kind === "upsert") this.accept(message.payload.agent);
        else this.forget(message.payload.agentId);
      },
    });
    for (const entry of agents.entries) this.accept(entry.agent);
    let cursor = agents.pageInfo.nextCursor;
    while (cursor) {
      const page = await this.paseo.agents.list({ page: { limit: 100, cursor } });
      for (const entry of page.entries) this.accept(entry.agent);
      cursor = page.pageInfo.nextCursor;
    }
    this.kick();
  }

  private accept(agent: PaseoAgent) {
    this.agents.set(agent.id, agent);
    const workspace = agent.workspaceId ? this.workspaces.get(agent.workspaceId) : undefined;
    if (!this.settings.enabled || agent.archivedAt || agent.internal || !workspace ||
      !this.settings.projectNames.some(name => name.toLowerCase() === workspace.projectDisplayName.toLowerCase())) {
      this.forget(agent.id); return;
    }
    let session = this.store.state.sessions[agent.id];
    if (!session) this.store.state.sessions[agent.id] = session = sessionSchema.parse({
      id: agent.id, workspaceId: workspace.id, projectId: workspace.projectId,
      projectName: workspace.projectDisplayName, workspaceTitle: workspace.title ?? workspace.name,
      title: agent.title ?? "Untitled session", status: agent.status,
    });
    session.status = agent.status;
    session.workspaceId = workspace.id;
    session.projectId = workspace.projectId;
    session.workspaceTitle = workspace.title ?? workspace.name;
    session.projectName = workspace.projectDisplayName;
    if (session.lastAutoName && agent.title !== session.lastAutoName) session.nameLocked = true;
    session.title = agent.title ?? "Untitled session";
    if (this.watched.has(agent.id) || this.lifetime.signal.aborted) return;
    const subscription = this.paseo.agents.ref(agent.id).timeline.subscribe(event => {
      if (event.event.type === "error") {
        session.error = "Live observation disconnected; reconnecting";
        this.watched.get(agent.id)?.(); this.watched.delete(agent.id);
        this.schedule(agent.id, 5000, () => { this.accept(this.agents.get(agent.id) ?? agent); });
      } else if (event.event.type === "replacement" || event.event.type === "subscription_restored") {
        session.coverage = "recovering"; this.schedule(agent.id, 100);
      } else if (event.event.type === "timeline" || /turn_(completed|failed|canceled)/.test(event.event.type)) {
        this.schedule(agent.id, 1500);
      }
    });
    this.watched.set(agent.id, subscription);
    void subscription.ready.then(() => this.schedule(agent.id, 100)).catch(() => {
      session.error = "Cannot subscribe to this session";
      this.watched.delete(agent.id);
      this.schedule(agent.id, 10000, () => this.accept(this.agents.get(agent.id) ?? agent));
    });
  }

  private forget(id: string) {
    this.watched.get(id)?.(); this.watched.delete(id);
    const timer = this.timers.get(id); if (timer) clearTimeout(timer);
    this.timers.delete(id);
    if (this.store.state.sessions[id]) this.store.state.sessions[id].status = "not watched";
  }

  private schedule(id: string, delay: number, action = () => { void this.sync(id).catch(error => this.recordError(id, error)); }) {
    if (this.lifetime.signal.aborted || this.timers.has(id)) return;
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); if (!this.lifetime.signal.aborted) action(); }, delay));
  }

  private recordError(id: string, error: unknown) {
    const session = this.store.state.sessions[id];
    if (session) session.error = error instanceof Error ? error.message : "Observation failed";
    void this.store.save().catch(() => { this.error = "Cannot save observation state"; });
  }

  sync(id: string) {
    const current = this.syncing.get(id); if (current) { this.schedule(id, 1000); return current; }
    const promise = this.readDelta(id).finally(() => this.syncing.delete(id));
    this.syncing.set(id, promise); return promise;
  }

  private async readDelta(id: string) {
    const session = this.store.state.sessions[id];
    if (!session || !this.watched.has(id) || !this.settings.enabled) return;
    const timeline = this.paseo.agents.ref(id).timeline;
    let page = await timeline.refetch({ direction: session.epoch ? "after" : "tail", limit: 50, projection: "canonical",
      ...(session.epoch ? { cursor: { epoch: session.epoch, seq: Math.max(0, session.cursor - 1) } } : {}),
    });
    if (page.error) throw new Error("Cannot read session activity");
    if (!session.epoch || page.staleCursor || page.reset || page.epoch !== session.epoch) {
      page = await timeline.refetch({ direction: "tail", limit: 50, projection: "canonical" });
      if (page.error) throw new Error("Cannot establish session history");
      const reset = session.epoch !== null;
      if (reset) { session.pending = []; session.recent = []; session.anchors = []; session.fingerprints = {}; session.cursor = 0; }
      session.epoch = page.epoch;
      session.coverage = page.hasOlder || page.gap || reset ? "partial" : "following";
      session.historyIncomplete = session.coverage === "partial";
      if (page.hasOlder) {
        const head = await timeline.refetch({ direction: "before", cursor: { epoch: page.epoch, seq: page.window.minSeq + 30 }, limit: 30, projection: "canonical" });
        if (!head.error && !head.staleCursor && head.epoch === page.epoch) ingest(session, head.entries);
      }
    }
    if (page.gap) { session.coverage = "partial"; session.historyIncomplete = true; }
    let pages = 0;
    let needsRecovery = false;
    while (!this.lifetime.signal.aborted) {
      if (page.staleCursor || page.epoch !== session.epoch) { session.coverage = "recovering"; needsRecovery = true; this.schedule(id, 500); break; }
      if (page.gap) { session.coverage = "partial"; session.historyIncomplete = true; }
      ingest(session, page.entries);
      await this.store.save();
      if (!page.hasNewer || !page.endCursor) break;
      if (++pages >= 20) { this.schedule(id, 1000); break; }
      page = await timeline.refetch({ direction: "after", cursor: page.endCursor, limit: 50, projection: "canonical" });
      if (page.error) throw new Error("Activity recovery interrupted; saved position retained");
    }
    if (session.coverage === "recovering" && !needsRecovery) session.coverage = session.historyIncomplete ? "partial" : "following";
    session.error = null;
    this.kick();
  }

  private kick() {
    if (this.worker || !this.settings.enabled || this.lifetime.signal.aborted) return;
    this.worker = this.drain().catch(error => { this.error = error instanceof Error ? error.message : "Observer failed"; })
      .finally(() => {
        this.worker = null;
        if (!this.lifetime.signal.aborted && !this.wakeTimer) this.wakeTimer = setTimeout(() => { this.wakeTimer = null; this.kick(); }, 5000);
      });
  }

  private async drain() {
    while (!this.lifetime.signal.aborted && this.settings.enabled) {
      const session = Object.values(this.store.state.sessions)
        .filter(value => this.watched.has(value.id) && value.pending.length && (this.cooldown.get(value.id) ?? 0) <= Date.now())
        .sort((a,b) => (this.served.get(a.id) ?? 0) - (this.served.get(b.id) ?? 0) || Number(b.status === "running") - Number(a.status === "running"))[0];
      if (!session) return;
      const inputs = batch(session.pending);
      const epoch = session.epoch;
      const projectId = session.projectId;
      const workspaceId = session.workspaceId;
      const peers = Object.values(this.store.state.sessions).filter(peer => peer.id !== session.id && peer.projectId === session.projectId && this.watched.has(peer.id));
      this.busy = session.id;
      this.served.set(session.id, ++this.batchNumber);
      try {
        const result = await this.luna.analyze(session, peers, inputs, this.lifetime.signal);
        if (this.lifetime.signal.aborted || !this.settings.enabled || epoch !== session.epoch || projectId !== session.projectId || workspaceId !== session.workspaceId || !this.watched.has(session.id)) continue;
        session.analysis = checkedAnalysis(result, session, peers, inputs);
        const processed = new Set(inputs.map(input => `${input.seq}:${input.fingerprint}`));
        session.pending = session.pending.filter(input => !processed.has(`${input.seq}:${input.fingerprint}`));
        session.updatedAt = new Date().toISOString(); session.error = null;
        await this.store.save();
        if (this.settings.autoName && !session.nameLocked && (genericName(session.title) || session.title === session.lastAutoName)) await this.rename(session.id, false);
      } catch (error) {
        this.recordError(session.id, error);
        this.cooldown.set(session.id, Date.now() + 60000);
      } finally { this.busy = null; }
    }
  }

  async review(id: string) {
    await this.sync(id);
    const session = this.store.state.sessions[id];
    if (!session || !this.watched.has(id)) throw new Error("This session is outside the watched projects");
    if (!session.pending.length) session.pending = [...session.recent];
    this.served.set(id, -1);
    this.cooldown.delete(id); await this.store.save(); this.kick();
  }

  async rename(id: string, workspace: boolean) {
    const session = this.store.state.sessions[id];
    if (!session?.analysis || !this.watched.has(id)) throw new Error("Review this session before naming it");
    if (workspace) {
      const current = await this.paseo.workspaces.ref(session.workspaceId).refresh();
      if (!current || (current.title ?? current.name) !== session.workspaceTitle) throw new Error("Workspace name changed; refresh before applying this name");
      await this.paseo.workspaces.ref(session.workspaceId).setTitle(session.analysis.workspaceName);
      for (const other of Object.values(this.store.state.sessions)) if (other.workspaceId === session.workspaceId) other.workspaceTitle = session.analysis.workspaceName;
      this.store.state.workspaceNames[session.workspaceId] = { name: session.analysis.workspaceName, locked: false };
    } else {
      const current = await this.paseo.agents.ref(id).refresh();
      if (!current || current.agent.title !== session.title) throw new Error("Session name changed; refresh before applying this name");
      const name = session.analysis.suggestedName;
      await run(await executable("paseo"), ["agent", "update", id, "--name", name, "--home", this.home, "--json"], "", this.luna.directory, this.lifetime.signal, 10000);
      session.title = name; session.lastAutoName = name;
    }
    await this.store.save();
  }

  async updateSettings(settings: Settings) {
    this.settings = settings;
    let cursor: string | undefined;
    do {
      const page = await this.paseo.agents.list({ page: { limit: 100, ...(cursor ? {cursor} : {}) } });
      for (const entry of page.entries) this.accept(entry.agent);
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    this.kick();
  }

  async stop() {
    this.lifetime.abort();
    for (const timer of this.timers.values()) clearTimeout(timer);
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    for (const unsubscribe of this.watched.values()) unsubscribe();
    this.watched.clear();
    for (const cleanup of this.cleanups.reverse()) await cleanup();
    await Promise.allSettled([...this.syncing.values(), ...(this.worker ? [this.worker] : [])]);
    await this.store.flush();
  }
}
