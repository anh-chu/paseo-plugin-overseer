Overseer follows sessions in the same project and checks for conflicting work, scope changes, and departures from explicit user instructions. It keeps a short account of each session's purpose, scope, decisions, and next action. Open Overseer in the sidebar or in a workspace panel.

The plugin listens to live timeline events. It saves its read position and pending activity together, recovers missed activity after reconnecting, and uses gpt-6-luna through the local Codex CLI to review new activity in batches. It uses the daemon's existing Codex login. It does not create visible helper tabs.

Settings select projects by name. Katalon is selected by default. Existing long sessions start with their beginning and recent activity; omitted earlier history is marked incomplete. New activity is followed from the saved position. Large individual messages and tool outputs are excerpted. Reasoning and plugin timeline rows are excluded.

Alerts must include quotes that match the activity the plugin read. The model can still miss or misinterpret a conflict. Alerts are advisory. Overseer does not send instructions to working sessions, stop them, or change their permissions.

Tab and workspace names are suggested in the session detail. Apply a name there. Automatic workspace naming is on by default. It changes generic workspace names or names managed by Overseer after all watched tabs finish review, deriving one shared name from their purposes and scopes. Renames are at least 30 minutes apart. Existing descriptive names are preserved until you choose Allow automatic workspace naming. Keep workspace name locks the current name, and an external name change also locks further automatic changes. Automatic tab naming has a separate switch and is off by default. Existing naming plugins remain enabled.

Requires Paseo 0.15.1 or later and an authenticated Codex CLI with access to gpt-6-luna. Selected session activity is sent to Codex for analysis. Summaries, pending activity, and read positions are stored on the daemon under plugin-data/overseer.
