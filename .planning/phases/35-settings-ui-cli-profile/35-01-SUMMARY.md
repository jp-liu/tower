---
phase: 35-settings-ui-cli-profile
plan: "01"
subsystem: settings-ui
tags: [settings, cli-profile, i18n, server-actions]
dependency_graph:
  requires: [30-schema-foundation, 31-pty-primitives-env-injection]
  provides: [CLIP-04]
  affects: [src/app/settings/page.tsx, src/components/settings/]
tech_stack:
  added: []
  patterns: [server-actions, useI18n, inline-edit-card]
key_files:
  created:
    - src/actions/cli-profile-actions.ts
    - src/components/settings/cli-profile-config.tsx
  modified:
    - src/lib/i18n.tsx
    - src/components/settings/settings-nav.tsx
    - src/app/settings/page.tsx
decisions:
  - "CLI Profile save converts baseArgsText (newline-separated) to JSON array and envVarsText (KEY=VALUE lines) to JSON object before DB write"
  - "Validation errors thrown from server action are caught in component handleSave and shown as saveError status"
  - "Loading state shown as '...' while getDefaultCliProfile resolves; noProfile fallback shown if isDefault row absent"
metrics:
  duration: 146s
  completed: "2026-04-10"
  tasks: 2
  files_changed: 5
---

# Phase 35 Plan 01: CLI Profile Settings UI Summary

**One-liner:** CLI Profile settings card with inline command/baseArgs/envVars editing backed by server actions and bilingual i18n.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Server actions + i18n keys | 1e50603 | src/actions/cli-profile-actions.ts, src/lib/i18n.tsx |
| 2 | CliProfileConfig component + wiring | 3649dd7 | src/components/settings/cli-profile-config.tsx, src/components/settings/settings-nav.tsx, src/app/settings/page.tsx |

## What Was Built

### Server Actions (`src/actions/cli-profile-actions.ts`)

- `getDefaultCliProfile()` — reads the `isDefault: true` CliProfile row, returns id/name/command/baseArgs/envVars (raw JSON strings) or null
- `updateCliProfile(id, data)` — validates baseArgs as JSON array and envVars as JSON object before calling `db.cliProfile.update()`, then `revalidatePath("/settings")`

### i18n Keys (`src/lib/i18n.tsx`)

Added 12 keys to both `zh` and `en` translation objects under the `settings.cliProfile.*` namespace:
- title, desc, navDesc, command, commandHint, commandPlaceholder
- baseArgs, baseArgsHint, baseArgsPlaceholder
- envVars, envVarsHint, envVarsPlaceholder
- saved, saveError, invalidJson, noProfile

### CliProfileConfig Component (`src/components/settings/cli-profile-config.tsx`)

- `"use client"` with `useI18n`, `useState`, `useEffect`, `useCallback`
- Loads profile on mount via `getDefaultCliProfile()`
- Displays loading (`...`) while fetching, noProfile message if no default row
- Three edit fields: `command` (text input, w-64), `baseArgsText` (textarea, 4 rows, font-mono), `envVarsText` (textarea, 4 rows, font-mono)
- `handleSave`: converts baseArgsText → JSON array, envVarsText → JSON object, calls `updateCliProfile`, shows 2s status message
- Follows GeneralConfig visual pattern exactly: h2 + p desc + mt-8 space-y-8 sections + h3 label + p hint + mt-3 input

### Nav + Page Wiring

- `settings-nav.tsx`: Added `Terminal` icon import, added `cli-profile` NAV_ITEM after `config`
- `settings/page.tsx`: Added `CliProfileConfig` import and `activeSection === "cli-profile"` conditional render

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — CliProfileConfig reads live data from `getDefaultCliProfile()` on mount. Data is displayed from the actual DB row.

## Self-Check: PASSED

- `src/actions/cli-profile-actions.ts` — exists
- `src/components/settings/cli-profile-config.tsx` — exists
- `src/lib/i18n.tsx` — settings.cliProfile.title present in both zh and en
- Task commits 1e50603, 3649dd7 — verified in git log
- TypeScript: only 5 pre-existing errors (agent-config-actions.ts, pty-session.test.ts) — no new errors
