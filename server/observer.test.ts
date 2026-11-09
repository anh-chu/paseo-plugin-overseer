import { mkdtemp, rm } from "node:fs/promises";
import type { PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import { afterEach, expect, it, vi } from "vitest";
import { preferences, sessionSchema, analysisSchema } from "../shared/contracts";
import { Observer } from "./observer";
import { Store } from "./store";
import { Luna } from "./model";

const running: {observer: Observer; directory: string}[] = [];
afterEach(async () => { for (const {observer, directory} of running.splice(0)) { await observer.stop(); await rm(directory, {recursive: true, force: true}); } });
const result = analysisSchema.parse({purpose: "Fix report counts", scope: ["Reports"], decisions: [], resources: [], nextAction: "Check counts", suggestedName: "Fix report counts", workspaceName: "Reliable report counts", findings: []});

async function fixture(analyze = vi.fn().mockResolvedValue(result)) {
  const directory = await mkdtemp("/tmp/overseer-engine-");
  const store = new Store(directory); await store.load();
  const session = sessionSchema.parse({id: "one", workspaceId: "workspace", projectId: "project", projectName: "Katalon", workspaceTitle: "Reports", title: "Report counts", status: "running", epoch: "old", cursor: 5});
  store.state.sessions.one = session;
  const refetch = vi.fn();
  const api = {agents: {ref: () => ({timeline: {refetch}})}} as unknown as PaseoApi;
  const nameWorkspace = vi.fn().mockResolvedValue(result.workspaceName);
  const luna = {directory, analyze, nameWorkspace} as unknown as Luna;
  const observer = new Observer(api, store, luna, preferences.schema.parse({}), "/tmp/not-a-daemon");
  observer.watched.set("one", vi.fn());
  running.push({observer, directory});
  return {observer, store, session, refetch, analyze, api, nameWorkspace};
}
const row = {seqStart: 6, seqEnd: 6, item: {type: "user_message", text: "Fix report counts only"}};
const page = {entries: [row], epoch: "old", error: null, staleCursor: false, reset: false, gap: false, hasNewer: false, hasOlder: false, endCursor: {epoch: "old", seq: 6}, window: {minSeq: 0, maxSeq: 6}};

it("reads only the saved range on reconnect and retains work if Luna fails", async () => {
  const {observer, session, refetch} = await fixture(vi.fn().mockRejectedValue(new Error("Offline")));
  refetch.mockResolvedValue(page);
  await observer.sync("one");
  await vi.waitFor(() => expect(session.error).toBe("Offline"));
  expect(refetch.mock.calls[0][0]).toMatchObject({direction: "after", cursor: {epoch: "old", seq: 4}});
  expect(session.cursor).toBe(6);
  expect(session.pending).toHaveLength(1);
});

it("does not consume a growing streaming row when an earlier version finishes analysis", async () => {
  let finish!: (value: typeof result) => void;
  const first = new Promise<typeof result>(resolve => {finish = resolve;});
  const analyze = vi.fn().mockReturnValueOnce(first).mockRejectedValue(new Error("Pause next analysis"));
  const {observer, session, refetch} = await fixture(analyze);
  refetch.mockResolvedValue(page);
  await observer.sync("one");
  await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
  refetch.mockResolvedValue({...page, entries: [{...row, item: {...row.item, text: "Fix report counts only, then run the report"}}]});
  await observer.sync("one");
  finish(result);
  await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
  expect(session.pending).toHaveLength(1);
  expect(session.pending[0].text).toContain("then run the report");
});

it("rejects an old analysis after the timeline epoch changes", async () => {
  let finish!: (value: typeof result) => void;
  const promise = new Promise<typeof result>(resolve => {finish = resolve;});
  const analyze = vi.fn().mockReturnValueOnce(promise).mockRejectedValue(new Error("Hold new epoch"));
  const {observer, session, refetch} = await fixture(analyze);
  refetch.mockResolvedValue(page);
  await observer.sync("one");
  await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(1));
  refetch.mockResolvedValue({...page, epoch: "new", endCursor: {epoch: "new", seq: 6}});
  await observer.sync("one");
  finish(result);
  await vi.waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
  expect(session.analysis).toBeNull();
  expect(session.historyIncomplete).toBe(true);
});

it("passes only sessions from the same project into Luna", async () => {
  const {observer, store, refetch, analyze} = await fixture();
  const same = {...store.state.sessions.one, id: "same"};
  const other = {...store.state.sessions.one, id: "other", projectId: "other-project"};
  store.state.sessions.same = same; store.state.sessions.other = other;
  observer.watched.set("same", vi.fn()); observer.watched.set("other", vi.fn());
  refetch.mockResolvedValue(page);
  await observer.sync("one");
  await vi.waitFor(() => expect(analyze).toHaveBeenCalled());
  expect(analyze.mock.calls[0][1].map((peer: {id: string}) => peer.id)).toEqual(["same"]);
});

it("refuses to overwrite a tab renamed since the suggestion was made", async () => {
  const {observer, session, api} = await fixture();
  session.analysis = result;
  api.agents.ref = vi.fn().mockReturnValue({refresh: vi.fn().mockResolvedValue({agent: {title: "User's chosen name"}})});
  await expect(observer.rename("one", false)).rejects.toThrow("name changed");
});

it("refuses to overwrite a workspace renamed since the suggestion was made", async () => {
  const {observer, session, api} = await fixture();
  session.analysis = result;
  const setTitle = vi.fn();
  Object.assign(api, {workspaces: {ref: () => ({refresh: vi.fn().mockResolvedValue({title: "User's workspace", name: "Reports"}), setTitle})}});
  await expect(observer.rename("one", true)).rejects.toThrow("name changed");
  expect(setTitle).not.toHaveBeenCalled();
});

async function workspaceFixture() {
  const context = await fixture();
  context.session.analysis = result;
  context.session.workspaceTitle = "main";
  let title = "main";
  const descriptor = (): PaseoWorkspace => ({id: "workspace", title, name: "main", projectId: "project", projectDisplayName: "Katalon"} as PaseoWorkspace);
  const setTitle = vi.fn(async (next: string) => { title = next; context.observer.observeWorkspace(descriptor()); return {title}; });
  Object.assign(context.api, {workspaces: {ref: () => ({refresh: vi.fn(async () => descriptor()), setTitle})}});
  return {...context, setTitle, externalRename: (next: string) => {title = next; context.observer.observeWorkspace(descriptor());}};
}

it("automatically names a generic workspace and does not mistake its own event for a manual change", async () => {
  const {observer, session, store, setTitle} = await workspaceFixture();
  await observer.nameReadyWorkspaces();
  expect(setTitle).toHaveBeenCalledWith("Reliable report counts");
  expect(session.workspaceTitle).toBe("Reliable report counts");
  expect(store.state.workspaceNames.workspace.locked).toBe(false);
});

it("preserves an existing descriptive workspace name until explicitly allowed", async () => {
  const {observer, session, setTitle, externalRename} = await workspaceFixture();
  externalRename("My report workspace");
  await observer.nameReadyWorkspaces();
  expect(setTitle).not.toHaveBeenCalled();
  await observer.toggleWorkspaceNameLock(session.id);
  await vi.waitFor(() => expect(setTitle).toHaveBeenCalledOnce());
});

it("waits for all workspace tabs to finish review and derives one name from them together", async () => {
  const {observer, store, setTitle, session, nameWorkspace} = await workspaceFixture();
  const peer = {...session, id: "peer", analysis: {...result, workspaceName: "Different purpose"}};
  store.state.sessions.peer = peer; observer.watched.set("peer", vi.fn());
  peer.pending = [{seq: 1, role: "user_message", text: "New direction", fingerprint: "new"}];
  await observer.nameReadyWorkspaces(); expect(setTitle).not.toHaveBeenCalled();
  expect(nameWorkspace).not.toHaveBeenCalled();
  peer.pending = [];
  await observer.nameReadyWorkspaces(); expect(setTitle).toHaveBeenCalledOnce();
  expect(nameWorkspace.mock.calls[0][0]).toHaveLength(2);
});

it("persists a manual workspace override and blocks further automatic writes", async () => {
  const {observer, store, externalRename, setTitle} = await workspaceFixture();
  await observer.nameReadyWorkspaces();
  externalRename("My chosen workspace name");
  await store.save();
  const restored = new Store(store.directory); await restored.load();
  expect(restored.state.workspaceNames.workspace.locked).toBe(true);
  await observer.nameReadyWorkspaces(); expect(setTitle).toHaveBeenCalledOnce();
});

it("does not rename again during the workspace naming cooldown", async () => {
  const {observer, session, setTitle} = await workspaceFixture();
  await observer.nameReadyWorkspaces();
  session.analysis = {...result, workspaceName: "A different report name"};
  await observer.nameReadyWorkspaces(); expect(setTitle).toHaveBeenCalledOnce();
});

it("respects the workspace naming switch", async () => {
  const {observer, setTitle} = await workspaceFixture();
  observer.settings.autoNameWorkspaces = false;
  await observer.nameReadyWorkspaces(); expect(setTitle).not.toHaveBeenCalled();
});

it("serializes concurrent requests to rename the same workspace", async () => {
  const {observer, setTitle} = await workspaceFixture();
  const results = await Promise.allSettled([observer.rename("one", true), observer.rename("one", true)]);
  expect(setTitle).toHaveBeenCalledOnce();
  expect(results.filter(value => value.status === "rejected")).toHaveLength(1);
});

it("discards a generated workspace name when another tab arrives during naming", async () => {
  const {observer, store, session, nameWorkspace, setTitle} = await workspaceFixture();
  let finish!: (name: string) => void;
  nameWorkspace.mockReturnValueOnce(new Promise<string>(resolve => {finish = resolve;}));
  const work = observer.nameReadyWorkspaces();
  await vi.waitFor(() => expect(nameWorkspace).toHaveBeenCalled());
  store.state.sessions.new = {...session, id: "new", analysis: null};
  observer.watched.set("new", vi.fn());
  finish("Reliable report counts");
  await work;
  expect(setTitle).not.toHaveBeenCalled();
});
