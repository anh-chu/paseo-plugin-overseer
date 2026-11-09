import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Store } from "./store";
import { activity, ingest } from "./activity";
import { sessionSchema } from "../shared/contracts";

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) await rm(path, {recursive: true, force: true}); });
it("restores pending activity and its cursor together after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "overseer-store-")); directories.push(directory);
  const first = new Store(directory); await first.load();
  const session = sessionSchema.parse({id: "one", projectId: "project", projectName: "Example", workspaceId: "workspace", workspaceTitle: "Reports", title: "Reports", status: "running", epoch: "epoch"});
  first.state.sessions.one = session;
  ingest(session, [{seqStart: 8, seqEnd: 9, item: {type: "user_message", text: "Keep this pending during restart"}}]);
  await first.save();
  const second = new Store(directory); await second.load();
  expect(second.state.sessions.one.cursor).toBe(9);
  expect(second.state.sessions.one.pending[0].text).toBe("Keep this pending during restart");
  ingest(second.state.sessions.one, [{seqStart: 8, seqEnd: 9, item: {type: "user_message", text: "Keep this pending during restart"}}]);
  expect(second.state.sessions.one.pending).toHaveLength(1);
});
it("preserves corrupt state and stops rather than silently starting over", async () => {
  const directory = await mkdtemp(join(tmpdir(), "overseer-store-")); directories.push(directory);
  const file = join(directory, "state.json"); await writeFile(file, "broken");
  await expect(new Store(directory).load()).rejects.toThrow("preserve");
  expect(await readFile(file, "utf8")).toBe("broken");
});
