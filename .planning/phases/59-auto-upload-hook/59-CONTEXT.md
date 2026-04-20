# Phase 59: Auto-Upload Hook - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous --auto)

<domain>
## Phase Boundary

Claude Code PostToolUse hook that auto-captures file outputs as task assets. Includes env variable rename (AI_MANAGER_TASK_ID → TOWER_TASK_ID), configurable type whitelist, Settings UI for hook installation, and the hook script itself.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — --auto mode. Key notes:

- Rename AI_MANAGER_TASK_ID → TOWER_TASK_ID across all code (3 occurrences in agent-actions.ts)
- Add TOWER_API_URL injection alongside TOWER_TASK_ID
- Hook script: standalone file (e.g. scripts/post-tool-hook.sh or .ts) that:
  - Exits immediately if no TOWER_TASK_ID env var
  - Checks if the written file matches type whitelist
  - POSTs to TOWER_API_URL/api/internal/assets/upload with the file
- Settings page: button to install/uninstall the hook in ~/.claude/settings.json
- SystemConfig: hooks.autoUploadTypes for configurable type whitelist
- Hook entry format: PostToolUse hook in Claude Code settings.json

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/actions/agent-actions.ts` — PTY spawn with env injection (lines 206, 319, 549)
- `src/components/settings/system-config.tsx` — Settings page
- `src/actions/config-actions.ts` — SystemConfig CRUD
- `src/app/api/internal/assets/` — Existing asset upload routes

### Established Patterns
- Internal API routes with localhost guard
- SystemConfig for app-level settings
- i18n for all user-facing text

### Integration Points
- PTY spawn environment injection
- ~/.claude/settings.json for hook registration
- Asset upload API

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond success criteria.

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
