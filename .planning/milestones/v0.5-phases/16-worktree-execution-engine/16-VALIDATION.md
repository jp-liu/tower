---
phase: 16
slug: worktree-execution-engine
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-31
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + playwright |
| **Config file** | vitest.config.ts, playwright.config.ts |
| **Quick run command** | `pnpm vitest run tests/unit/lib/worktree.test.ts tests/unit/actions/git-actions.test.ts` |
| **Full suite command** | `pnpm vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run tests/unit/lib/worktree.test.ts tests/unit/actions/git-actions.test.ts`
- **After every plan wave:** Run `pnpm vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | WT-01 | unit | `pnpm vitest run tests/unit/lib/worktree.test.ts` | ❌ W0 | ⬜ pending |
| 16-01-02 | 01 | 1 | WT-02 | unit | `pnpm vitest run tests/unit/lib/worktree.test.ts` | ❌ W0 | ⬜ pending |
| 16-02-01 | 02 | 2 | BR-01 | unit | `pnpm vitest run tests/unit/components/create-task-dialog.test.tsx` | ✅ | ✅ green |
| 16-02-02 | 02 | 2 | WT-04 | integration | `pnpm vitest run` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/lib/worktree.test.ts` — stubs for WT-01, WT-02
- [ ] Existing `tests/unit/actions/git-actions.test.ts` covers getProjectBranches

*Existing infrastructure covers test framework — vitest already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Branch selector visible in create-task dialog | BR-01 | UI visual verification | Open create task dialog for a GIT project, verify branch dropdown appears |
| Two tasks execute concurrently in same project | WT-04 | Requires two simultaneous CLI sessions | Start two tasks in same project, verify both run in separate worktrees |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
