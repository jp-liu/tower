---
phase: 59-auto-upload-hook
verified: 2026-04-20T18:30:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 59: Auto-Upload Hook Verification Report

**Phase Goal:** Files produced by Claude Code during task execution are automatically captured as task assets without any manual action from the user
**Verified:** 2026-04-20T18:30:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When running outside a Tower session (no TOWER_TASK_ID), the hook exits immediately with no side effects | VERIFIED | `scripts/post-tool-hook.js` lines 28-31 check `process.env.TOWER_TASK_ID` and `process.exit(0)` if absent. Confirmed by running hook without env var -- exit code 0, no output. |
| 2 | When Claude Code writes a file matching the configured type whitelist during a Tower session, the file appears in the task's asset list within seconds | VERIFIED | Hook parses stdin JSON (tool_name in Write/Edit/MultiEdit set), extracts file_path, checks extension against whitelist, POSTs to `/api/internal/hooks/upload`. Upload route copies file via `fs.copyFile` and creates `ProjectAsset` DB record. |
| 3 | The allowed file types are configurable in Settings and stored in SystemConfig under hooks.autoUploadTypes | VERIFIED | `system-config.tsx` loads `hooks.autoUploadTypes` via `getConfigValue` on mount, saves via `setConfigValue` on button click. Upload route reads the same key via `readConfigValue("hooks.autoUploadTypes", DEFAULT_UPLOAD_TYPES)`. |
| 4 | The Settings page has an "Install Hook" button that writes the PostToolUse hook entry into ~/.claude/settings.json; the button reflects installation state | VERIFIED | `system-config.tsx` fetches GET `/api/internal/hooks/install` on mount to check status. Button text toggles between install/uninstall. POST handler appends hook entry, DELETE handler removes it. Install route reads/writes `~/.claude/settings.json` correctly. |
| 5 | All code references to AI_MANAGER_TASK_ID are replaced with TOWER_TASK_ID; the PTY spawn environment injects TOWER_TASK_ID and TOWER_API_URL | VERIFIED | `agent-actions.ts` has 3 occurrences of `TOWER_TASK_ID` and 3 of `TOWER_API_URL`, 0 occurrences of `AI_MANAGER_TASK_ID` as env keys. Signal dir renamed to `tower-signals`. Security rules updated. Only residual mentions are in `assistant-actions.ts` comments (not functional). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/actions/agent-actions.ts` | TOWER_TASK_ID and TOWER_API_URL env injection | VERIFIED | 3 injection sites with TOWER_TASK_ID + TOWER_API_URL, signal dir = "tower-signals" |
| `src/app/api/internal/hooks/upload/route.ts` | Internal upload endpoint for hook | VERIFIED | 157 lines, exports GET (config) and POST (upload), localhost guard, CUID validation, size check, type whitelist, copyFile, DB record |
| `scripts/post-tool-hook.js` | PostToolUse hook script | VERIFIED | 178 lines, uses only Node.js builtins (fs, path, http, https), gates on TOWER_TASK_ID, parses stdin, checks extension, POSTs to upload API |
| `src/app/api/internal/hooks/install/route.ts` | Hook install/uninstall API | VERIFIED | 112 lines, exports GET (check status), POST (install), DELETE (uninstall), reads/writes ~/.claude/settings.json |
| `src/components/settings/system-config.tsx` | Hook config UI section | VERIFIED | Contains autoUploadTypes input, install/uninstall button with status reflection, fetchHookStatus on mount |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/post-tool-hook.js` | `/api/internal/hooks/upload` | HTTP POST with taskId + filePath | WIRED | Line 144: `new URL("/api/internal/hooks/upload", apiUrl)`, line 145: `JSON.stringify({ taskId, filePath })` |
| `src/app/api/internal/hooks/upload/route.ts` | `data/assets/{projectId}` | fs.copyFile | WIRED | Line 134: `await copyFile(filePath, destPath)`, destPath via `ensureAssetsDir(projectId)` |
| `src/components/settings/system-config.tsx` | `/api/internal/hooks/install` | fetch POST/DELETE/GET | WIRED | Line 57: GET on mount, line 148: POST/DELETE on button click |
| `src/app/api/internal/hooks/install/route.ts` | `~/.claude/settings.json` | fs read/write | WIRED | Line 10: `SETTINGS_PATH`, line 14: `readSettings` uses `readFileSync`, line 27: `writeSettings` uses `writeFileSync` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `system-config.tsx` (hookStatus) | hookStatus | GET `/api/internal/hooks/install` | Yes -- reads actual ~/.claude/settings.json | FLOWING |
| `system-config.tsx` (autoUploadTypes) | autoUploadTypes | `getConfigValue("hooks.autoUploadTypes")` | Yes -- reads SystemConfig DB | FLOWING |
| `upload/route.ts` (POST) | task.projectId | `db.task.findUnique` | Yes -- real DB query | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Hook exits 0 without TOWER_TASK_ID | `echo JSON \| node scripts/post-tool-hook.js` | exit 0, no output | PASS |
| Hook exits 0 for non-write tools | `echo Read JSON \| TOWER_TASK_ID=x node scripts/post-tool-hook.js` | exit 0, no output | PASS |
| Hook script has valid syntax | `node -c scripts/post-tool-hook.js` | "SYNTAX OK" | PASS |
| Hook exits 0 with unreachable server | `echo Write JSON \| TOWER_TASK_ID=x TOWER_API_URL=http://localhost:59999 node scripts/post-tool-hook.js` | exit 0 | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| HOOK-01 | 59-01 | Global PostToolUse hook script gated by TOWER_TASK_ID env var | SATISFIED | `post-tool-hook.js` checks TOWER_TASK_ID at line 29, exits 0 if absent |
| HOOK-02 | 59-01 | Hook detects file creation matching configured types, uploads to Tower API, checks file exists, respects maxUploadBytes | SATISFIED | Hook checks extension (line 96), file existence (line 101-104). Upload route checks size (line 86-92) and type (line 96-104) |
| HOOK-03 | 59-02 | File type whitelist configurable via SystemConfig hooks.autoUploadTypes | SATISFIED | Settings UI loads/saves `hooks.autoUploadTypes`. Upload route reads from same config key |
| HOOK-04 | 59-01 | Internal upload API accepts taskId + filePath, copies to data/assets/{projectId}/ | SATISFIED | Upload route POST handler validates inputs, copies file, creates ProjectAsset record |
| HOOK-05 | 59-01 | Env var rename AI_MANAGER_TASK_ID to TOWER_TASK_ID, add TOWER_API_URL, signal dir rename | SATISFIED | 0 occurrences of AI_MANAGER env keys, 3x TOWER_TASK_ID, 3x TOWER_API_URL, tower-signals dir |
| HOOK-06 | 59-02 | Settings page "Install Hook" button appends hook entry to ~/.claude/settings.json | SATISFIED | Install route POST appends to PostToolUse array (line 88), DELETE filters by marker (line 103-104). UI reflects state |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scripts/post-tool-hook.js` | 116 | `http.get(url, ...)` not wrapped in try/catch -- throws on malformed URL (e.g., port > 65535) | Warning | In practice Tower always injects valid URL; only affects edge case of corrupted TOWER_API_URL |
| `src/actions/assistant-actions.ts` | 17, 76 | Comments still reference `AI_MANAGER_TASK_ID` instead of `TOWER_TASK_ID` | Info | Stale comments only, no functional impact |

### Human Verification Required

### 1. Settings Hook Section Visual Check

**Test:** Navigate to Settings page, scroll to Hooks section
**Expected:** See "Auto-upload File Types" input with comma-separated extensions and Install/Uninstall button with correct state
**Why human:** Visual layout and component rendering cannot be verified programmatically

### 2. End-to-End Hook Execution During Task

**Test:** Install the hook via Settings, start a task execution, have Claude Code write a .png file
**Expected:** The file appears in the task's asset list within seconds without user action
**Why human:** Requires running PTY session with Claude Code and verifying asset list UI

### 3. Hook Install/Uninstall Round-Trip

**Test:** Click "Install Hook", check ~/.claude/settings.json, click "Uninstall Hook", check again
**Expected:** PostToolUse entry appears after install, is removed after uninstall, other hooks preserved
**Why human:** Requires interactive UI testing with side-effect verification

### Gaps Summary

No blocking gaps found. All 5 observable truths verified, all 6 requirements satisfied, all artifacts exist and are substantive and wired with real data flow. Two minor anti-patterns noted (missing try/catch in hook for malformed URL, stale comments referencing old env var name) -- neither blocks goal achievement.

---

_Verified: 2026-04-20T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
