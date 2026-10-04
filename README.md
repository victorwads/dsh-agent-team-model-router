# dsh-agent-team-model-router

> **Experimental / known lifecycle issue.** Live tests confirmed explicit spawning on Luna medium, Luna low and Sol low, and a teammate switching Luna → Sol with the same session ID. However, a subsequent `list_agents` call failed with `cannot get required service "agentTeams" in inactive context`. Root cause is not established. This release is not production-stable; use a backed-up test profile. UI display-name editing is implemented in the development version; installed profiles need a rebuilt client asset and reload to use it.

Local Cordis/DSH plugin for **DSH 0.2.0-rc.2 only**. Extends upstream Agent Teams with explicit provider/model selection and next-inference routing. It does not fork the Team service, edit installed DSH files, edit session files, or recreate teammates to switch models.

## Web boot fix in 0.1.3

0.1.2 reused the original panel locale namespace `agent-team`, so enabling both browser entries could fail the entire Web boot. 0.1.3 isolates the router locale namespace as `agent-team-model-router`. The failure was reproduced with the plugin ACTIVE at the existing Web URL; rebuilding the linked client and refreshing restored the GUI with the corrected router asset loaded and no console errors. A regression now rejects duplicate original locale registration. This fixes that specific browser boot failure; the separate previously reported Host inactive-context issue is not claimed resolved.

## Safety fix in 0.1.1

**Do not install 0.1.0.** It could block Session creation when the user's last profile patch re-enabled tool-agent-team. That loaded the original tools beside the router's child tools and registered team:policy twice. This was reproduced from the reported stack trace and fixed with shared, reference-counted per-Agent policy/tool registrations. The safe hot-install guard rejects a conflicting existing live composition before route tools are installed. Tests now include the actual Cordis Loader and component toggles, not only direct plugin mounting.

If you uninstalled after this failure, keep the profile recovered until updating/building this repository. Back up and stop your profile before relinking. Check your final user patch for tool-agent-team with disabled: false: setting it true is recommended while using the router, although 0.1.1 now tests that duplicate-enabled startup does not block sessions. This repository does not automatically edit that user override.

## Status and compatibility

Tested against exact 0.2.0-rc.2 AgentLoop, Agent Teams, SubagentRuntime, LLM runtime and JSONL persistence packages using keyless scripted adapters. Tests assert the actual adapter stream request's provider/model/sessionId and history. Real cloud-provider credentials and the user's Web profile are not modified or exercised by this suite. No claim of compatibility with another DSH version.

Requires Node 22.23+ and the experimental Agent Teams bundle, its normal spawn/fork providers, Session persistence/projections, Tools/SystemPrompt/LLM services, and the Host subagent-model-selection setting. The router bundle must follow the Agent Teams bundle.

## Local development

From this repository:


Build/test commands:

~~~sh
npm ci --ignore-scripts
npm run build
npm test
npm pack --dry-run
~~~

The suite currently contains 27 tests (including display-name host persistence and browser DOM coverage), with the original 21 routing/composition integration tests, including actual Cordis Loader duplicate-component startup and safe rejection of conflicting hot-install; see docs/VERIFICATION.md.

Source is ordinary ESM JavaScript; build copies it into lib. All DSH integration dependencies are pinned to 0.2.0-rc.2. No compiled core override is shipped.

## Install into a profile (manual, not performed automatically)

These commands CHANGE the chosen profile's dependencies and bundle configuration. Back up the profile first. Stop that profile's running DSH process before installation; do not hot-install over an already mounted tool-agent-team. Use your own profile name, not a guessed default.

~~~sh
REPO="$HOME/path/to/dsh-agent-team-model-router"  # replace with your clone path
PROFILE=web  # replace with your actual profile
cd "$REPO"
npm ci --ignore-scripts
npm run build
npm test

dsh --version  # must print 0.2.0-rc.2
# Skip this if the bundle is already installed/enabled:
dsh plugin --profile "$PROFILE" add @deepseek-ai/dsh-experimental-agent-team-profile@0.2.0-rc.2
# Profile-local link to this built package:
dsh plugin --profile "$PROFILE" add "link:$REPO"
# Inspect the composed tree without booting:
dsh --profile "$PROFILE" --dump-config
# Restart the existing profile, not a replacement Vite server:
dsh --profile "$PROFILE"
~~~

The package declares a DSH bundle patch. Installing it via dsh plugin activates that patch: it disables the original tool-agent-team row and inserts agent-team-model-router. The router mounts the SAME upstream tool plugin as its child after installing decorations; all other Team tools/transactions remain upstream. Check the dump for exactly one active Team tool composition, plus the router. Do not add a second manual router entry. Keep the Agent Teams bundle enabled and ordered before this bundle in the profile's dsh.profile.bundles array.

If profile-local linking does not share the expected runtime packages in your package-manager setup, use npm pack and install the resulting tgz via dsh plugin --profile "$PROFILE" add /absolute/path/to/package.tgz. The runtime deliberately rejects mismatched package versions.

## Enable model selection

Use the DSH settings UI: enable **subagent-model-selection** and authorize exact provider/model routes. Use identifiers from your profile's registered providers (including account-backed route IDs where applicable), not generic vendor names. The same Host setting governs subagent delegation and this plugin; no new hardcoded model catalog.

For deployments configuring that setting through a profile patch, the existing entry is subagent-model-selection-settings, with name @deepseek-ai/dsh-tool-subagent/model-selection-settings and config.enabled/config.allowedModels. Patch the existing entry rather than mounting a duplicate service:

~~~yaml
- id: subagent-model-selection-settings
  config:
    enabled: true
    allowedModels:
      - provider: YOUR_REGISTERED_PROVIDER_ID
        model: YOUR_EXACT_MODEL_ID
~~~

Verify the entry ID in your dump before applying this example. The deployment base can be overridden by the stored user setting. Routes are sampled for NEW top-level Sessions and captured in native subagent/model-selection-policy events; children inherit the captured allowlist. Existing Sessions without that opt-in remain disabled. Start a new Session after enabling or changing the policy; restarting an old Session does not silently widen its permissions.

## Tools

| Tool | Who | Behavior |
| --- | --- | --- |
| spawn_teammate | Lead | Upstream tool plus optional provider, model, reasoning_effort. Provider/model must be supplied together. Omission is passed unchanged to upstream. |
| list_models | Team members | Returns all exact allowed routes, with runtime adapter metadata and availability; optional provider/model filter. |
| get_current_model | Team members | Actual last-used request header, pending selection and next route, plus session ID. |
| set_teammate_display_name | Lead | Edit/reset UI label without changing stable targets, including cold members. |
| switch_model | Teammate | Schedules explicit route for its next prompt assembly/model invocation. |
| switch_teammate_model | Lead | Same switch for an exact live teammate in that Team; does not wake/recreate it. |

Existing list_subagent_models remains unchanged when another delegation surface provides it. list_models reuses DSH's registry and exact-model resolver, but returns a structured complete allowlist including unadvertised authorized IDs, availability and capabilities. The upstream helper is not publicly exported in the released rc.2, so route-merging/policy validation code is vendored from #8324 with MIT attribution, not imported from invented subpaths.

## Example workflow

First call list_models({}) and use returned IDs. The symbolic values below are placeholders, not valid hardcoded routes:

~~~ts
// Lead
list_models({})
spawn_teammate({
  name: "backend",
  description: "Implement backend changes",
  prompt: "Implement and test the backend. Discover routes before choosing one.",
  provider: PROVIDER_A,
  model: MODEL_A,
})

// backend (same session and identity throughout)
get_current_model({})
switch_model({ provider: PROVIDER_B, model: MODEL_B })
// Next model invocation uses B. Work, then switch back:
switch_model({ provider: PROVIDER_A, model: MODEL_A })

// Lead, while backend is live:
switch_teammate_model({ teammate: "backend", provider: PROVIDER_B, model: MODEL_B })
~~~

## Editing display names

~~~ts
set_teammate_display_name({ target: "backend", display_name: "Backend — Revisão Ágil" })
set_teammate_display_name({ target: "lead", display_name: "ADMIN" })
// Reset to stable target:
set_teammate_display_name({ target: "backend", display_name: null })
~~~

Lead-only. Targets come from list_agents, never from the visual alias. Cold members can be renamed without waking them. Session IDs, task ownership, mailbox and stable names are unchanged. Names allow case/spaces/accents; empty/control/bidi-override text is rejected. Display aliases persist in successful native tool receipts and are exposed by the agentTeamDisplayNames projection; absence of the plugin does not make Session logs unreadable.

Rebuild with npm run build, then reload the plugin/profile and refresh the existing Web URL. No automatic HMR update is promised. The client entry must be recognized from the updated package manifest. Do not disable the original Team Panel; the alias-aware panel shadows its registered slot at a different priority. UI rendering is tested with React DOM/jsdom; the user's live Web profile still needs verification after refresh. GitHub publication is experimental; live GUI validation after profile restart remains pending.

## Exact switching semantics

A running inference is never replaced or aborted. installModelSelection snapshots the route BEFORE prompt assembly and uses that same snapshot for request routing. A switch after that snapshot applies to a later invocation. In DSH vocabulary, multiple model invocations are **steps within one turn**: a switch tool invoked at step N can affect step N+1 within the same turn; it does not wait for turn/end. This is the requested next-model-invocation behavior, not a whole-turn cancellation/restart.

The successful response includes current, pending, next, changed, effective: next-model-invocation. Current comes from the actual latest request/header (creation options only before the first inference). Reasoning effort is the resolved request value. A concurrent switch cannot split prompt identity from provider dispatch.

Selection writes the native model/selection event through Session.append, then updates the live reference and awaits sessions.flush. Cold resume restores child-owned selections before inference, despite the original descriptor retaining creation-time routing. Session/history/name/tasks/ownership/mailbox are untouched. A flush failure reports that the route is committed in memory but durability failed; it does not claim rollback. Inspect current state before retrying.

No-op: identical effective/pending route produces no selection event. Duplicate switches serialize per session. No hidden automatic routing or arbitrary cooldown. Logs identify teammate/session/from/to, never credential objects.

## Architecture and limitations

- compatibility/dsh-0.2.0-rc.2.js: version/API guards and Cordis internal/get decoration of caller-traced services. A scoped AsyncLocalStorage value carries validated spawn options across the original Team transaction into startContinuable. No prototype mutation/core patch/private Activation access.
- routing: plugin-owned projection reads native events; live routing uses the public installModelSelection waterfall.
- tools: canonical structured output schemas.
- vendor: MIT route helper studied from the #8324 implementation; see NOTICE and docs/INVESTIGATION.md.

Limitations:

1. Lead switching targets LIVE teammates only. Cold/unloaded targets return a useful error; resume with send_message first. No offline persisted-file edits or unsafe residency borrowing.
2. Restart with the bundle patch. Version 0.1.1 reference-counts the upstream Team policy/tool registrations per Agent scope if a later user override re-enables the original component, preventing the 0.1.0 duplicate team:policy failure. Hot-install over tools already registered in LIVE Agent scopes is refused before changing them; stop/restart first. Plugin unload/reload is not a mechanism for switching; ensure no active work before changing composition. Do not unload the router while a second Team Tools instance retains its decorated registrations; restart to change that composition.
3. Models are validated by the adapter's exact resolver and Session allowlist. DSH catalogs are advisory; an adapter may accept IDs it does not advertise. Availability means registered/resolvable, not a guarantee of credentials/quota/network success.
4. Existing list_agents in rc.2 reports creation-time options and uses provider for spawn/fork. It is NOT the authoritative runtime route. Use get_current_model; native modelSelection projections are updated by model/selection/request headers where the Web controller supplies them.
5. Other plugins that override agent/request after this selection layer are not certified; do not add competing routing middleware. In-flight request retries stay on their prepared adapter.
6. Display names only change labels in the Agent Team panel, not session titles/sidebar or stable targets. The plugin ships a version-specific isolated copy of the rc.2 panel at a higher-priority supported slot; the original panel remains available when this client entry unloads. Native tool/result or tool/ptc-dispatch receipts persist aliases. If a caller invokes the tool body outside the native execution pipeline, no receipt is written and no alias is committed.
7. Whole profile UI boot and external provider calls are not certified by the keyless tests. No changes to the user's running GUI are made.

## Verify loading

Look for [agent-team-model-router] loaded for DSH 0.2.0-rc.2 in Host logs. In a NEW opted-in Agent Team Session, list_models should report your authorized routes; spawn_teammate schema should include route fields. Have a teammate call get_current_model, switch_model and get_current_model again. The next recorded request/header must use the new route. Run npm test for keyless inference/persistence regression coverage before linking updates.

## Future DSH versions

Fail closed until the compatibility layer is reviewed against the exact new source and integration tests are run. Do not loosen the version guard blindly. Prefer upstream public route pass-through/shared discovery exports when they actually ship, then remove the rc.2 decoration/vendor layer. Native descriptor schemas and lifecycle ownership must remain upstream-controlled.
