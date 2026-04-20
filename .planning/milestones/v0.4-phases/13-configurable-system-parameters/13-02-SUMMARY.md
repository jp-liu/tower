---
phase: 13-configurable-system-parameters
plan: 02
subsystem: settings-ui-config-wiring
tags: [settings-ui, i18n, system-parameters, git-params, search-params, branch-template, debounce]
dependency_graph:
  requires: [13-01-config-defaults-registry]
  provides: [system-config-ui-sections, client-side-config-consumers]
  affects: [settings-config-page, task-detail-panel, search-dialog]
tech_stack:
  added: []
  patterns: [batch-config-read-on-mount, immutable-spread-state-updates, debounce-dep-array-wiring]
key_files:
  created: []
  modified:
    - src/lib/i18n.tsx
    - src/components/settings/system-config.tsx
    - src/components/task/task-detail-panel.tsx
    - src/components/layout/search-dialog.tsx
decisions:
  - "getConfigValues batch call on mount loads all 8 config values in single DB query"
  - "Upload size stored as bytes, displayed/edited as MB — conversion on load and save"
  - "branchTemplate error state cleared on input change, validated only on save"
  - "debounceMs added to search useEffect dependency array to prevent stale closure bug"
metrics:
  duration: "~7 minutes"
  completed: "2026-03-30"
  tasks_completed: 2
  files_created: 0
  files_modified: 4
---

# Phase 13 Plan 02: Settings UI Sections + Client-Side Config Wiring Summary

**One-liner:** Added System, Git Parameters, and Search settings sections to system-config.tsx with getConfigValues batch loading, and wired task-detail-panel branch template and search-dialog debounce to read from SystemConfig instead of hardcoded values.

## What Was Built

### Task 1: i18n Keys + Settings UI Sections + Client-Side Wiring

**src/lib/i18n.tsx** — Added 24 new i18n keys in both zh and en locales:
- System section: title, desc, maxUpload, maxUploadHint, maxConcurrent, maxConcurrentHint, saved (7 keys per locale)
- Git params section: title, desc, timeout, timeoutHint, branchTemplate, branchTemplateHint, branchTemplateInvalid, saved (8 keys per locale)
- Search section: title, desc, resultLimit, resultLimitHint, allModeCap, allModeCapHint, debounceMs, debounceMsHint, snippetLength, snippetLengthHint, saved (11 keys per locale)

**src/components/settings/system-config.tsx** — Extended with:
- 3 new form state types: `SystemForm`, `GitParamsForm`, `SearchForm`
- 3 new state variables + `branchTemplateError` state
- Extended `useEffect` to call `getConfigValues` for all 8 new config keys in one batch
- MB conversion on load: `Math.round(storedBytes / 1024 / 1024)`, MB to bytes on save: `inputMb * 1024 * 1024`
- 3 save handlers: `handleSaveSystem`, `handleSaveGitParams`, `handleSaveSearch`
- Branch template validation via `validateBranchTemplate` before save
- 3 new JSX sections with controlled inputs and Save buttons
- Added `getConfigValues` and `validateBranchTemplate` imports

**src/components/task/task-detail-panel.tsx** — Wired branch template:
- Added `getConfigValue` and `interpolateBranchTemplate` imports
- Added `branchTemplate` state (default: `"vk/{taskIdShort}-"`)
- Added `useEffect` to load `git.branchTemplate` from config on mount
- Replaced hardcoded `` `vk/${task.id.slice(0, 4)}-` `` with `interpolateBranchTemplate(branchTemplate, task.id)`

**src/components/layout/search-dialog.tsx** — Wired debounce:
- Added `getConfigValue` import
- Added `debounceMs` state (default: 250)
- Added `useEffect` to load `search.debounceMs` from config on mount
- Replaced hardcoded `250` in `setTimeout` with `debounceMs`
- Added `debounceMs` to the search `useEffect` dependency array (critical — prevents stale closure)

### Task 2: Checkpoint (Auto-approved in AUTO mode)

Visual and functional verification auto-approved per AUTO mode configuration.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| getConfigValues batch call on mount | Single DB query for all 8 keys — more efficient than 8 sequential getConfigValue calls, consistent with Plan 01 search-actions pattern |
| Upload size MB conversion | D-12 from RESEARCH.md: stored in bytes for precision, displayed in MB for user comprehension |
| branchTemplateError cleared on input change | Avoids stale error messages persisting while user is fixing the template |
| debounceMs in search useEffect dep array | RESEARCH.md Pitfall 4: without this, stale closure captures initial 250ms even after config loads a different value |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all config values are fully wired to SystemConfig. No placeholder or hardcoded values remain in the modified components for the 8 config keys.

## Verification

- TypeScript: `npx tsc --noEmit` — no errors in modified files (4 pre-existing errors in agent-config-actions.ts and stream/route.ts documented in 13-01 Summary)
- Acceptance criteria verified:
  - i18n.tsx: system.title (2), gitParams.title (2), search.title (2), gitParams.branchTemplateInvalid (2) — all present in both locales
  - system-config.tsx: all 8 config keys, validateBranchTemplate, min={1}/max={500}, min={1}/max={10}, handleSaveSystem/GitParams/Search — all present
  - task-detail-panel.tsx: interpolateBranchTemplate, git.branchTemplate — present; hardcoded `vk/${task.id.slice(0, 4)}` — absent
  - search-dialog.tsx: search.debounceMs, debounceMs — present; hardcoded `, 250)` in setTimeout — absent (only in getConfigValue default arg)

## Self-Check: PASSED

Files exist:
- src/lib/i18n.tsx: EXISTS (modified)
- src/components/settings/system-config.tsx: EXISTS (modified)
- src/components/task/task-detail-panel.tsx: EXISTS (modified)
- src/components/layout/search-dialog.tsx: EXISTS (modified)

Commits exist:
- 2d2d15d: feat(13-02): i18n keys + settings UI sections + client-side config wiring
