# Display names — development implementation

Tool: set_teammate_display_name({ target, display_name }). Lead-only; null resets. Stable Team name/session ID/tasks/mailbox are unchanged. Cold members do not need waking. Display text is NFC-normalized, trimmed, limited to 120 characters and rejects control/bidi override characters.

Persistence: successful native tool/result (paired toolCallId) and tool/ptc-dispatch receipts carry a versioned alias operation. Plugin projection agentTeamDisplayNames merges operations by member Session ID. This avoids external required Session events, descriptor modifications and file writes. The receipt commits before UI projection changes. Direct execute() outside the native pipeline is not durable. No automatic inference/cancellation is needed to change names.

UI: official rc.2 Team panel bundle is isolated in vendor/rc2-team-panel.js under MIT attribution. Build adds a second Session projection read and derives member labels without mutating original Team data. Same official slot ID at priority -10 shadows priority 0. Navigation continues using IDs. Original panel returns when alias-aware client entry unloads. Client manifest declares exact upstream injection names; no core files are modified.

Verified: 27 tests passed, including built browser factory rendering in React DOM/jsdom, alias updates, navigation ID, native Lead tool inference receipt, persistence/restart, PTC merge/reset/fork-boundary rejection, permissions and task identity preservation, plus existing 21 routing/composition regressions. Build and git diff --check passed.

Still to verify: actual existing Web URL client loading after plugin/profile reload and refresh. No active dev:web watcher has been verified; no HMR promise. No profile restart/reinstallation was performed. Existing reported agentTeams inactive-context issue remains unresolved. User subsequently authorized commit/publication while deferring profile restart. Live GUI verification remains pending: the authenticated page loads the old manifest without router/client.js and this session has no display-name tool. No forced reload/restart was performed.
