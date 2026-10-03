# Verification — DSH 0.2.0-rc.2

Node v22.23.2. All tested DSH packages pinned to 0.2.0-rc.2.

Commands passed:

~~~sh
npm run build
npm test
npm pack --dry-run
git diff --check
~~~

Initial 0.1.0 verification: 17 integration tests, 17 passed, 0 failed. This did NOT cover duplicate Team Tools profile composition; a real user reported a blocking duplicate team:policy failure. The 0.1.1 regression suite has 21 tests and adds direct duplication, actual Cordis Loader startup in both orders/component toggle, and safe hot-install rejection. Final build/test/package results are verified after the safety fix. Actual AgentLoop, Team service, upstream Team tools, SubagentRuntime, spawn/fork providers, Session projections and JSONL persistence are exercised. Separate adapters are registered for the two keyless test providers. Actual stream GenerateOptions includes asserted provider/model/reasoningEffort/sessionId; tests are not metadata-only.

Coverage: explicit spawn/inheritance; self switching and unchanged session; repeated A→B→C→A; no-op/invalid effort/disallowed routes; runtime authorized model metadata; Lead live switch and duplicate pending requests; task owner and mailbox preservation; exact-model rejection; cold resume and full runtime restart with history; fork seed route isolation; disabled opt-in preserving inheritance; missing compatibility APIs; cancellation; unavailable provider; concurrent spawn isolation; switch after prompt snapshot; plugin disposal preserving Lead identity.

The assembly race fixture is attached to the exact Agent scope AFTER installModelSelection, so the barrier is genuinely after the selection snapshot. A global barrier would execute before agent-scoped middleware and would not test this ordering.

Limits: no real provider credentials/network quota used; no user profile installation or Web UI restart performed. UI display-name aliases are not implemented. Future DSH versions are rejected until separately reviewed/tested. Installation/link commands are documented for the user to execute against their chosen profile.
