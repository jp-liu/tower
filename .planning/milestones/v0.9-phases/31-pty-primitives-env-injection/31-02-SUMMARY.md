---
phase: 31-pty-primitives-env-injection
plan: "02"
subsystem: agent-execution
tags: [pty, cli-profile, env-injection, callback-url]
dependency_graph:
  requires: ["31-01"]
  provides: ["CliProfile-driven PTY spawning with env injection"]
  affects: ["startPtyExecution", "resumePtyExecution"]
tech_stack:
  added: []
  patterns: ["CliProfile DB lookup", "envOverrides injection", "callbackUrl persistence"]
key_files:
  modified:
    - src/actions/agent-actions.ts
decisions:
  - "callbackUrl persisted to TaskExecution.callbackUrl column on start; inherited from prevExec on resume"
  - "envOverrides built with profileEnvVars spread + AI_MANAGER_TASK_ID always; CALLBACK_URL only when present"
  - "profileBaseArgs replaces hardcoded --dangerously-skip-permissions in both start and resume"
metrics:
  duration: 142s
  completed_date: "2026-04-11"
  tasks_completed: 2
  files_modified: 1
---

# Phase 31 Plan 02: CliProfile-Driven PTY Spawning with Env Injection Summary

CliProfile DB-driven CLI spawning with AI_MANAGER_TASK_ID and CALLBACK_URL injection into both startPtyExecution and resumePtyExecution.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Wire startPtyExecution to CliProfile and env injection | 834abf8 | src/actions/agent-actions.ts |
| 2 | Wire resumePtyExecution to CliProfile and env injection | cb65266 | src/actions/agent-actions.ts |

## What Was Built

Both `startPtyExecution` and `resumePtyExecution` in `src/actions/agent-actions.ts` now:

1. Query `db.cliProfile.findFirst({ where: { isDefault: true } })` to get the CLI binary and base arguments
2. Inject `AI_MANAGER_TASK_ID: taskId` into every spawned PTY session environment
3. Inject `CALLBACK_URL` when a callback URL is provided (start) or inherited from the previous execution (resume)
4. Pass `envOverrides` as the 7th argument to `createSession` (added in Plan 31-01)

`startPtyExecution` additionally:
- Accepts a new optional `callbackUrl?: string | null` parameter
- Persists `callbackUrl` to `TaskExecution.callbackUrl` in the DB create call

`resumePtyExecution` additionally:
- Reads `prevExec.callbackUrl` and propagates it to `envOverrides.CALLBACK_URL` if present

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `src/actions/agent-actions.ts` exists and was modified
- Commit 834abf8 exists: `feat(ai-manager-31.02): wire startPtyExecution to CliProfile and env injection`
- Commit cb65266 exists: `feat(ai-manager-31.02): wire resumePtyExecution to CliProfile and env injection`
- `tsc --noEmit` passes (only pre-existing errors in agent-config-actions.ts and pty-session.test.ts, unrelated to this plan)
- `db.cliProfile.findFirst` appears 2 times (once per function)
- `AI_MANAGER_TASK_ID` injected in both functions
- `CALLBACK_URL` injected in both functions (conditionally)
- No `createSession(taskId, "claude"` hardcoded command string remains
