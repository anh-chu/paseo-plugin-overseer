import { expect, it } from "vitest";
import { codexArguments, parseOutput } from "./model";
import { analysisSchema } from "../shared/contracts";

it("pins Luna and disables working-agent tools and configuration", () => {
  const args = codexArguments("/tmp/observer", ["/home/example/.agents/skills/example/SKILL.md"]);
  expect(args).toContain("gpt-6-luna");
  expect(args).toContain("--ignore-user-config");
  expect(args).toContain("--ephemeral");
  expect(args).toContain("features.shell_tool=false");
  expect(args).toContain("features.apps=false");
  expect(args.join(" ")).toContain("enabled=false");
});
it("rejects any observed tool execution", () => {
  expect(() => parseOutput(JSON.stringify({type: "item.completed", item: {type: "command_execution"}}))).toThrow("tool call");
});
it("validates the model's final JSON", () => {
  const value = analysisSchema.parse({purpose: "Report counts", scope: [], decisions: [], resources: [], nextAction: "Check results", suggestedName: "Fix report counts", workspaceName: "Report results", findings: []});
  expect(parseOutput(JSON.stringify({type: "item.completed", item: {type: "agent_message", text: JSON.stringify(value)}}))).toEqual(value);
});
