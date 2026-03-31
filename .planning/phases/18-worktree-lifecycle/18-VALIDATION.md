---
phase: 18
slug: worktree-lifecycle
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-31
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test:run -- tests/unit/lib/worktree.test.ts` |
| **Full suite command** | `pnpm test:run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:run -- tests/unit/lib/worktree.test.ts`
- **After every plan wave:** Run `pnpm test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | LC-01 (DONE) | unit | `pnpm test:run -- tests/unit/lib/worktree.test.ts` | ✅ (add describe) | ⬜ pending |
| 18-01-02 | 01 | 1 | LC-01 (CANCELLED) | unit | `pnpm test:run -- tests/unit/actions/task-actions.test.ts` | ✅ (add describe) | ⬜ pending |
| 18-01-03 | 01 | 1 | LC-01 (no-op) | unit | `pnpm test:run -- tests/unit/lib/worktree.test.ts` | ✅ (add describe) | ⬜ pending |
| 18-02-01 | 02 | 1 | LC-02 | unit | `pnpm test:run -- tests/unit/lib/instrumentation.test.ts` | ✅ (created by TDD task) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*No Wave 0 gaps. All test files either exist (worktree.test.ts, task-actions.test.ts) or are created by TDD tasks within their plan (instrumentation.test.ts in 18-02-01).*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
