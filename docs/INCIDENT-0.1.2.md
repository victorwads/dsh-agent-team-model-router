# Web boot failure — locale collision

The alias-aware browser panel copied rc.2 Team UI locale registration using namespace agent-team. The original UI remains enabled. DSH locale.register rejects a duplicate locale in a namespace; boot reports the router client fiber failed and blocks the entire Web shell. The original DOM harness mocked locale registration as a no-op and missed this integration constraint.

Reproduced the actual failure at http://127.0.0.1:3080 after the user re-enabled the plugin. Isolated duplicate-locale regression failed before the fix. Build now changes only the router locale namespace to agent-team-model-router. Rebuilt linked assets and refreshed the SAME URL, without server restart, replacement server or core/profile/session edits. Fresh snapshot shows the conversation UI; console reports zero errors. Read-only browser check confirms the fetched plugin resource contains router/client.js, the isolated namespace and alias projection, and no Failed to load plugins screen.

27 tests pass after the fix. This incident is distinct from earlier Host agentTeams inactive-context reports. Do not infer that unrelated Host lifetime issue is fixed.
