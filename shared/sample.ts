import {sessionViewSchema, analysisSchema} from "./contracts";

const entries = [
  ["Checkout refresh", "Payment validation", "Validate payment errors and keep checkout recovery clear.", "Payment errors now preserve the basket.", "Review the retry messages."],
  ["Checkout refresh", "Order confirmation", "Improve order confirmation and delivery estimates.", "Delivery estimates now use the chosen address.", "Check the confirmation on small screens."],
  ["Account access", "Password recovery", "Make password recovery accessible and reliable.", "Recovery links now expire after use.", "Verify keyboard navigation."],
];
export const sampleSessions = entries.map(([workspaceTitle, title, purpose, recentChange, nextAction], index) => sessionViewSchema.parse({
  id: `sample-${index}`, workspaceId: `sample-workspace-${index < 2 ? 0 : 1}`, projectId: "sample-project", projectName: "Northstar Store", workspaceTitle, title,
  status: "idle", coverage: "following", pendingCount: 0, workspaceNameLocked: false,
  lastActivityAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  analysis: analysisSchema.parse({purpose, scope: [purpose], decisions: [], resources: [], nextAction, suggestedName: title, workspaceName: workspaceTitle, findings: [], recentChange, needsDecision: []}),
}));
