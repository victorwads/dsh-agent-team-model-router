# Blocking duplicate Team Tools — 0.1.0

User reported all Sessions became unavailable after installing router; uninstall recovered them. Screenshot stack: prompt section "team:policy" is already registered in this scope, from upstream tool-agent-team install.

Read-only diagnosis of Web profile found a final user patch forcing tool-agent-team disabled:false. User patches apply AFTER bundle patches, overriding router disabled:true. Router mounted upstream Team Tools as a child; profile mounted it again. Agent creation dispatched duplicate section error, vetoing publication. The original suite missed this composition failure.

0.1.1: Cordis internal/get decorators retain one reference-counted team:policy and canonical upstream Team tools per exact Agent scope. Duplicate-enabled startup/component toggles share registrations. Existing LIVE scopes already owning Team tools cause router to refuse hot-install before registering its projections/tools. No Session/profile edits or core changes.

Added regressions: direct duplicate mount, actual Cordis Loader router+original entries, Lead/teammate creation and actual inference switch A→B, toggling original component, another root Session creation, refusal of hot-install while original tools remain operational. Keep original component disabled when possible; restart to change router residency.

User profile inspection was read-only. Router was NOT reinstalled and running DSH was NOT restarted. Whole live GUI restoration after reinstall still requires user testing/confirmation.
