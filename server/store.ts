import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stateSchema, type State } from "../shared/contracts";

export class Store {
  state: State = { version: 1, sessions: {}, dismissed: [], workspaceNames: {} };
  private writes = Promise.resolve();
  constructor(readonly directory: string) {}
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { this.state = stateSchema.parse(JSON.parse(await readFile(join(this.directory, "state.json"), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Saved overseer state is unreadable. Observation stopped to preserve it."); }
  }
  save() {
    const snapshot = JSON.stringify(this.state);
    const write = this.writes.catch(() => {}).then(async () => {
      const file = join(this.directory, "state.json");
      await writeFile(`${file}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    this.writes = write;
    return write;
  }
  flush() { return this.writes; }
}
