---
phase: 59-auto-upload-hook
plan: 02
subsystem: hooks
tags: [settings-ui, hook-install, config, posttooluse]

requires:
  - phase: 59-auto-upload-hook
    plan: 01
    provides: PostToolUse hook script at scripts/post-tool-hook.js
provides:
  - Hook install/uninstall API at /api/internal/hooks/install
  - Settings UI for auto-upload file types and hook lifecycle
affects: []

tech-stack:
  added: []
  patterns: [settings section pattern, fs read/write settings.json]

key-files:
  created:
    - src/app/api/internal/hooks/install/route.ts
  modified:
    - src/components/settings/system-config.tsx
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts

key-decisions:
  - "Hook status checked via GET on mount, toggled via POST/DELETE"
  - "Auto-upload types stored as hooks.autoUploadTypes array in SystemConfig"
  - "Install route uses requireLocalhost guard for safety"

patterns-established:
  - "Settings section: load config on mount, save on button click"
  - "Hook lifecycle: install appends to PostToolUse array, uninstall filters by marker"

requirements-completed: [HOOK-03, HOOK-06]

duration: 3min
completed: 2026-04-20
---

# Phase 59 Plan 02: Hook Settings UI Summary

Settings UI for configuring auto-upload file types and managing PostToolUse hook installation in ~/.claude/settings.json.

## One-liner

Hook install/uninstall API with Settings page section for type whitelist and lifecycle management.

## Changes Made

### Task 1: Hook install/uninstall API and Settings UI section
- Created `/api/internal/hooks/install` route with GET (check status), POST (install), DELETE (uninstall) handlers
- Added "Hooks" section to system-config.tsx with editable comma-separated file types input
- Added install/uninstall button that reflects actual hook state from ~/.claude/settings.json
- Added 9 i18n keys in both zh.ts and en.ts

**Commit:** 877ec43

## Verification

- TypeScript compiles without errors in modified files (pre-existing test errors unrelated)
- Route file exists with all three HTTP method handlers
- Settings component references autoUploadTypes config key
- i18n keys present in both language files

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED
