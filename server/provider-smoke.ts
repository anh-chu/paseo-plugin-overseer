import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {connectBridgeDaemon} from "./connection";
import {providerExecutor} from "./provider";
import {Luna} from "./model";
import {UsageLedger} from "./usage";
import {sessionSchema} from "../shared/contracts";
async function main() {
const directory = await mkdtemp("/tmp/overseer-provider-smoke-");
const connection = await connectBridgeDaemon();
const checks: {name: string; status: "passed" | "failed"; message?: string}[] = [];
try {
  const ledger = new UsageLedger(directory); await ledger.load();
  const review = new Luna(join(directory, "helper"), ledger, undefined, providerExecutor(connection.paseo, join(directory, "helper"), connection.createHelper));
  const session = sessionSchema.parse({id: "synthetic-review", workspaceId: "synthetic-workspace", projectId: "synthetic-project", projectName: "Sample Store", workspaceTitle: "Checkout errors", title: "Payment errors", status: "idle"});
  const events = [{seq: 1, role: "user", text: "Only improve payment error messages. Do not change billing logic.", fingerprint: "one"}, {seq: 2, role: "assistant", text: "I changed the payment failure message to explain how to retry. Billing logic is unchanged.", fingerprint: "two"}];
  for (const selection of process.argv.slice(2).length ? process.argv.slice(2) : ["claude/claude-haiku-4-5", "codex/gpt-6-luna"]) {
    review.setSelection(selection);
    try {
      const analysis = await review.analyze(session, [], events, new AbortController().signal);
      if (!analysis.purpose || analysis.findings.length) throw new Error("Expected a valid analysis without findings for authorized work");
      const call = ledger.report("all").recent[0];
      if (call.provider !== selection.split("/")[0] || call.status !== "completed") throw new Error("Provider identity or status was not recorded");
      checks.push({name: `${selection}: structured review and provider usage`, status: "passed"});
    } catch (error) { checks.push({name: `${selection}: structured review and provider usage`, status: "failed", message: error instanceof Error ? error.message : String(error)}); }
  }
  const projects = await connection.paseo.projects.list();
  if (projects.projects.some(project => project.projectRootPath.startsWith(directory))) {
    checks.push({name: "No helper projects left in Paseo", status: "failed", message: "Helper project was registered"});
  } else checks.push({name: "No helper projects left in Paseo", status: "passed"});
  await writeFile("/tmp/overseer-provider-smoke-usage.json", JSON.stringify(ledger.report("all"), null, 2));
} finally {
  await connection.close();
  await rm(directory, {recursive: true, force: true});
  await writeFile("/tmp/overseer-provider-smoke-tests.json", JSON.stringify(checks));
}
console.log(JSON.stringify(checks));
if (checks.some(check => check.status === "failed")) process.exitCode = 1;

}
void main().catch(error => {console.error(error); process.exitCode = 1;});
