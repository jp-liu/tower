---
phase: 17
slug: review-merge-workflow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-31
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/unit` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | MR-01 | unit | `npx vitest run tests/unit/api/stream-persist-result.test.ts -x` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | MR-01 | unit | `npx vitest run tests/unit/api/diff-route.test.ts -x` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 1 | MR-02, MR-03 | unit | `npx vitest run tests/unit/api/merge-route.test.ts -x` | ❌ W0 | ⬜ pending |
| 17-03-01 | 03 | 1 | RV-01 | unit | `npx vitest run tests/unit/api/stream-send-back.test.ts -x` | ❌ W0 | ⬜ pending |
| 17-03-02 | 03 | 1 | RV-02 | unit | `npx vitest run tests/unit/lib/worktree.test.ts -x` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/api/stream-persist-result.test.ts` — stubs for MR-01 (IN_REVIEW transition in persistResult)
- [ ] `tests/unit/api/diff-route.test.ts` — stubs for MR-01 (diff API response shape)
- [ ] `tests/unit/api/merge-route.test.ts` — stubs for MR-02, MR-03 (squash merge + conflict detection)
- [ ] `tests/unit/api/stream-send-back.test.ts` — stubs for RV-01 (send-back transition)

*Existing: `tests/unit/lib/worktree.test.ts` already covers createWorktree reuse logic (RV-02).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Diff view renders collapsible file blocks | MR-01 | Visual rendering | Open task in IN_REVIEW, verify each changed file has collapsible diff block with +/- counts |
| Merge confirmation dialog shows correct info | MR-02 | UI interaction | Click Merge button, verify dialog shows target branch, file count, commit count |
| Conflict warning disables merge button | MR-03 | Requires actual git conflict state | Create conflicting changes, verify merge button disabled and conflict files listed |
| Send-back via chat resumes in same worktree | RV-01, RV-02 | E2E user flow | Send message on IN_REVIEW task, verify task goes to IN_PROGRESS and new execution uses same worktree |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
