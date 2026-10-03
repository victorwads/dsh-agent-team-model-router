# Investigation — DSH 0.2.0-rc.2

## Evidence inspected

Installed CLI package and Agent/Session/LLM/Subagent/Tools/Team packages report 0.2.0-rc.2. The installed payload contains bundled ESM and declarations, not a working source checkout. Upstream release baseline: 639ed015397290b3745d163aafe02ffee4aa3f84.

- [#8324](https://github.com/deepseek-ai/deepseek-harness/discussions/8324): per-teammate route selection proposal and implementation.
- [Implementation branch](https://github.com/ivbrajkovic/deepseek-harness/tree/feat/agent-team-teammate-model-selection), inspected at 30da5c7: shared validation, policy sampler, discovery reference-counting, roster pass-through.
- [#8035](https://github.com/deepseek-ai/deepseek-harness/discussions/8035): Team provider means spawn/fork, not the LLM provider; roster omits agentOptions.

The upstream route validation helper is vendored with attribution because rc.2 does NOT export its model-selection/list-models/model-selection-state subpaths. We do not pretend the proposal's additional exports exist in rc.2.

## Lifecycle findings

TeamRoster owns provisioning identity and transactions; SubagentRuntime.startContinuable owns the descriptor and initial inbox receipt. ContinuableActivationRegistry retains the AgentHandle and inbox; natural settlement flushes then disposes residency. Cold delivery reconstructs through agents.resume using the ORIGINAL immutable version-3 subagent descriptor. The first descriptor is authoritative; appending another descriptor cannot update it.

Agent exports installModelSelection. It captures selection at system-prompt/assemble entry and applies the SAME captured route at agent/request. AgentLoop prepares/binds the adapter with llm.prepareCall AFTER that waterfall and logs the actual request/header. Therefore a switch affects the next assembly/request, never a request already being assembled or streamed. DSH calls these inference iterations steps inside a larger turn. A switch tool can affect the next step within that same turn; it does not wait for turn/end.

The existing Web Session Controller uses model/selection for durable intent and request/header for actual use. Our implementation now uses these native events, not external required events (which rc.2 persistence correctly refuses). No metadata/file surgery or Activation recycling is needed. Cold-resume setup restores the latest child-owned model/selection before any inference, overriding the old descriptor route. Fork-inherited selections are excluded by the projection's inherited boundary.

## Plugin integration

Cordis internal/get is a declared framework waterfall. The compatibility layer returns proxies over caller-traced tools/subagents; it does not change core methods or prototypes. Tool registration decoration extends the upstream spawn definition. AsyncLocalStorage carries validated route overrides across the ORIGINAL Team provisioning transaction and injects them at its startContinuable call. Parent identity matching prevents unrelated child calls from receiving the override.

The bundle disables only the original tool-agent-team composition row and mounts that exact upstream plugin as its child AFTER decoration. All upstream Team tool bodies and ownership checks remain intact. No fork of Team state/service is maintained. Live hot-install into a composition already owning the same scoped tool names is not supported: restart with the bundle patch, then resume.

Policies reuse native subagent/model-selection-policy and Host subagentModelSelection.current. Existing Sessions keep their durable allowlist. No silent widening based on new Host settings. Model metadata and effort validation are adapter-owned through resolveModelInfo/resolveCallConfig; catalogs remain advisory as in DSH.

## UI naming investigation

The shipped TeamMemberRow renders member.name directly from durable agentTeam projection. Team roster names are immutable addressing identifiers. UI-only display names need a separate client integration/projection, not changing team/member records or listMembers names. This feature is not implemented yet; future extension must leave send_message targets and task ownership untouched.

## Verification status

The initial six integration tests passed on exact rc.2 packages, using the actual AgentLoop/Team/Subagent/JSONL persistence and keyless scripted LLM adapters. They observe provider stream GenerateOptions (not only metadata): explicit spawn, inheritance, A→B, cold resume with history, A→B→C→A on one session, no-op/invalid effort/invalid route, and allowed runtime discovery. Later verification adds distinct provider adapter registrations, Lead-switch ownership/mailbox preservation, full runtime restart, fork inherited-boundary routing, cancellation, unavailable provider handling, explicit output schemas and packaging/install documentation. See tests/router.test.mjs and README.md for current coverage.
