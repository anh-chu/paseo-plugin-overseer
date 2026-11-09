Overseer helps you keep track of several AI sessions working on one project. See what each session is doing, what it should do next, and which decisions need your input, without rereading every chat. It flags signs of duplicate work or changes that stray from your instructions, with quotes from the sessions so you can check the concern.

It also replaces vague tab and workspace names with names that describe their work. Open the shared project brief from the sidebar or a workspace panel.

The plugin listens to session activity as it grows. It saves its read position and pending activity together, recovers after reconnecting, and sends new activity to your selected model in bounded batches. The project brief uses those saved reviews without extra model calls. Routine inbox sessions stay behind a link while their actionable concerns remain visible.

Requires Paseo 0.15.1 or later, Node.js 22 or later, the Paseo CLI on the daemon's PATH, and an enabled, authenticated provider. Choose projects and a review model in the plugin settings. No projects are selected on a new install. Claude, Codex, and other enabled Paseo providers appear in the model picker. The default is Codex Luna. Linux has been verified; macOS and Windows have not.

Observation, tab naming, and workspace naming have separate controls that apply to all watched projects. Workspace naming is on by default; tab naming is off. Automatic naming changes generic names or names previously managed by Overseer. Manual changes lock further automatic renames. Workspace names reflect all reviewed tabs, with at least 30 minutes between changes. Pausing observation leaves working sessions running.

Selected activity goes to the chosen provider using its Paseo configuration and credentials. Summaries, pending activity, read positions, and usage metadata are saved under the daemon's plugin-data/overseer directory. Each review uses a background helper in a private temporary directory. The helper is archived and its temporary project entry is removed afterward. Paseo and providers can retain archived history or native logs.

Claude tools are disabled, Codex uses read-only access with web search disabled, and OpenCode permissions are denied. Other providers use their configured permissions and the common no-tool instructions. Permission requests and invalid structured replies fail the review; source activity stays pending. An unavailable provider produces an error without switching models.

Findings require quotes that match source activity, but the model can still miss or misinterpret a conflict. Alerts are advisory: Overseer does not direct working sessions, stop them, or change their permissions. Long existing sessions can omit middle history, which is marked incomplete. Large activity rows are excerpted.

Usage shows reported tokens, provider and model identity, call outcomes, durations, payload sizes, and reported costs. Filters use UTC. Missing fields remain unknown; cached input and reasoning output are subsets of their parent totals. Costs are provider metadata, not an account bill. The latest 300 completed call details and lifetime daily aggregates are retained without raw prompts or replies in the usage ledger.
