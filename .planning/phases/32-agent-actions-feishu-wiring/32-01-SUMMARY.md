---
phase: 32-agent-actions-feishu-wiring
plan: "01"
subsystem: agent-actions, notify-agi.sh, settings.json
tags: [feishu, notification, pty, env-injection, stop-hook]
dependency_graph:
  requires: [Phase 31 env injection (AI_MANAGER_TASK_ID), CliProfile.envVars]
  provides: [Feishu notifications for ai-manager task completions, exit code signal files]
  affects: [startPtyExecution, resumePtyExecution, notify-agi.sh Stop hook]
tech_stack:
  added: []
  patterns: [exit code signal file convention, AI_MANAGER_TASK_ID gate in bash]
key_files:
  created: []
  modified:
    - src/actions/agent-actions.ts
    - ~/.claude/hooks/notify-agi.sh
    - ~/.claude/settings.json
decisions:
  - Exit code signal file written at TOP of onExit before any async DB operations — maximizes chance notify-agi.sh can read it before the Stop hook fires
  - notify-agi.sh uses retry loop (5x with 0.5s sleep) for signal file — handles race condition where onExit is still writing
  - ai-manager gate uses `exit 0` before legacy behavior — clean early-return, legacy sessions unchanged
  - FEISHU_NOTIFY_GROUP env var checked first, falls back to META_FILE telegram_group — allows both env-based and file-based group config
  - macOS-specific `date -j -f` syntax used for elapsed time parsing — matches target platform (Darwin)
metrics:
  duration: 126s
  completed: "2026-04-11"
  tasks_completed: 2
  files_modified: 3
---

# Phase 32 Plan 01: Agent Actions Feishu Wiring Summary

**One-liner:** Env var metadata injection (AI_MANAGER_TASK_TITLE, AI_MANAGER_STARTED_AT) + exit code signal files in PTY onExit callbacks + notify-agi.sh AI_MANAGER_TASK_ID gate with structured Feishu template + Stop hook in settings.json.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Inject task metadata env vars and write exit code signal file | b873201 | src/actions/agent-actions.ts |
| 2 | Update notify-agi.sh + add Stop hook to settings.json | b39efd2 | ~/.claude/hooks/notify-agi.sh, ~/.claude/settings.json |

## What Was Built

### Task 1: agent-actions.ts env injection + signal file

In both `startPtyExecution` and `resumePtyExecution`:

**envOverrides now includes:**
- `AI_MANAGER_TASK_ID` — task cuid (already existed from Phase 31)
- `AI_MANAGER_TASK_TITLE` — task.title for Feishu template (new)
- `AI_MANAGER_STARTED_AT` — ISO timestamp at execution start for elapsed time calc (new)

**onExit callback (both functions):**
- First line: `await writeFile('/tmp/ai-manager-exit-${taskId}', String(exitCode)).catch(() => {})` — written before any DB operations so notify-agi.sh can read it before the Claude Stop hook fires

### Task 2: notify-agi.sh gate + settings.json Stop hook

**notify-agi.sh:** Added ai-manager gate block immediately after dedup lock section:
- Checks `${AI_MANAGER_TASK_ID:-}` — empty means manual Claude session, falls through to legacy
- Reads exit code from `/tmp/ai-manager-exit-${AI_MANAGER_TASK_ID}` with 5-retry loop (0.5s each)
- Derives `STATUS` label: "✅ 完成" / "❌ 失败 (exit N)" / "⚠️ 未知"
- Computes elapsed time using macOS `date -j -f` with fallback
- Sends structured Feishu MSG: task title + status + elapsed + summary (500 char cap)
- Gate block ends with `exit 0` — legacy code path unreachable for ai-manager sessions
- Legacy code path preserved exactly below the gate

**~/.claude/settings.json:** Added `Stop` entry to `hooks` object:
```json
"Stop": [{ "hooks": [{ "command": "/Users/liujunping/.claude/hooks/notify-agi.sh", "timeout": 15, "type": "command" }] }]
```

## Verification Results

```
AI_MANAGER_TASK_TITLE in agent-actions.ts: 2 ✓
AI_MANAGER_STARTED_AT in agent-actions.ts: 2 ✓
ai-manager-exit- in agent-actions.ts: 2 ✓
AI_MANAGER_TASK_ID gate in notify-agi.sh: present ✓
ai-manager-exit- signal file in notify-agi.sh: present ✓
状态 (STATUS) in Feishu template: present ✓
Stop hook in settings.json: present ✓
settings.json valid JSON: PASS ✓
tsc --noEmit: no new errors ✓ (pre-existing errors in agent-config-actions.ts and pty-session.test.ts unchanged)
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all notification paths are fully wired. FEISHU_NOTIFY_GROUP env var or META_FILE telegram_group must be configured at runtime to receive notifications (this is expected — intentional runtime config, not a stub).

## Self-Check: PASSED

- `b873201` exists: `git log --oneline | grep b873201` ✓
- `b39efd2` exists: `git log --oneline | grep b39efd2` ✓
- `src/actions/agent-actions.ts` modified with 2x TASK_TITLE, 2x STARTED_AT, 2x signal file ✓
- `~/.claude/hooks/notify-agi.sh` has AI_MANAGER_TASK_ID gate with STATUS template ✓
- `~/.claude/settings.json` has Stop hook entry, valid JSON ✓
