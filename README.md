# Paseo Overseer

Follow project sessions as they grow. Review conflicting ownership, scope drift, and departures from explicit user instructions with `gpt-6-luna` through the authenticated Codex CLI.

## Run locally

```sh
npm ci
npm run typecheck
npm test
paseo plugin install /absolute/path/to/paseo-overseer
```

Open **Overseer** in the sidebar or a workspace panel. Select project names in the plugin settings. Katalon is selected by default. Concerns appear beside the sidebar item and in affected session composers while the client is connected.

## Observation

The daemon plugin owns agent and workspace list subscriptions, then subscribes to each selected session's live timeline. Events schedule bounded canonical history reads from a saved cursor. Reconnects recover from that cursor; timeline replacements invalidate old sequence positions and in-flight analysis. A long existing session starts with its opening and recent activity and remains marked as having incomplete history.

The store writes the cursor, pending activity, and summaries atomically. Matching fingerprints deduplicate replays and handle growing rows at the same sequence position. User requests remain in a separate bounded record alongside the model's summary. A failed analysis retains pending work for retry. One Codex process runs at a time, with fair scheduling between sessions.

The model runs in a private empty directory, with user configuration, project instructions, skills, hooks, apps, plugins, and tools disabled for that invocation. It cannot direct the working sessions. Every finding must cite matching source text; conflicts require evidence from both sessions. Matching a quote does not establish that the model's interpretation is correct.

## Names

The detail view applies suggested tab and workspace names. It checks the current name again before writing. Automatic workspace naming is on by default and has a separate settings switch. It changes generic names or names managed by Overseer after every watched tab finishes review. Luna derives one shared workspace name from all tab purposes and scopes together. Renames are at least 30 minutes apart, unchanged context is not sent for repeated naming calls, and concurrent requests are serialized. Existing descriptive names are preserved until you select Allow automatic workspace naming. Keep workspace name locks the current name. An external name change persists a lock across restarts.

Automatic tab naming is off by default. When enabled, it changes only generic names or names previously set by Overseer. An external tab name change locks further automatic changes. Existing naming plugins are not disabled.

## Checks

```sh
npm test -- --reporter=json --outputFile=/tmp/overseer-tests.json
npm run test:smoke
```

The smoke test makes a real Codex call with synthetic session activity and verifies that Luna detects explicit scope or ownership conflict. It requires Codex login and model access. It writes its result to `/tmp/overseer-smoke.json`.

Unit and integration tests cover durable replay, streaming row changes, source evidence, bounded batches, stale epochs, model failures, project isolation, and manual-name classification. They use temporary storage and do not alter live sessions.

## Limits

Alerts are advisory. There is no automatic interruption, reassignment, or permission override. Historical bootstrap can omit middle activity; individual activity rows are excerpted at 6,000 characters. Peer evidence is limited to recent excerpts and summaries. Live subscriptions restore after reconnect, but a daemon history gap cannot be reconstructed from a model summary. Selected activity goes to Codex using the daemon's login. State files stay under `$PASEO_HOME/plugin-data/overseer` with private file permissions.

The connection adapter uses the installed Paseo CLI's connection setup because the plugin server API does not expose a standing connection at startup. It is tested against Paseo 0.15.1. It needs revalidation when that internal CLI setup changes.
