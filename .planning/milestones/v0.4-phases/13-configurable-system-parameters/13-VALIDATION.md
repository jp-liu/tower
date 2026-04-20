---
phase: 13
slug: configurable-system-parameters
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit) + Playwright (e2e) |
| **Config file** | vitest.config.ts, playwright.config.ts |
| **Quick run command** | `pnpm test -- --run` |
| **Full suite command** | `pnpm test -- --run && pnpm exec playwright test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- --run`
- **After every plan wave:** Run `pnpm test -- --run && pnpm exec playwright test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | SYS-01 | unit | `pnpm test -- --run tests/unit/actions/asset-actions.test.ts` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | SYS-02 | unit | `pnpm test -- --run tests/unit/lib/process-manager.test.ts` | ❌ W0 | ⬜ pending |
| 13-01-03 | 01 | 1 | GIT-04 | unit | `pnpm test -- --run tests/unit/lib/adapters/execute.test.ts` | ❌ W0 | ⬜ pending |
| 13-01-04 | 01 | 1 | GIT-03 | unit | `pnpm test -- --run tests/unit/lib/branch-template.test.ts` | ❌ W0 | ⬜ pending |
| 13-01-05 | 01 | 1 | SRCH-05 | unit | `pnpm test -- --run tests/unit/actions/search-actions.test.ts` | ❌ W0 | ⬜ pending |
| 13-02-01 | 02 | 2 | SYS-01,SYS-02,GIT-03,GIT-04,SRCH-05 | manual | Settings UI visual verification | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/lib/process-manager.test.ts` — stubs for SYS-02 (canStartExecution async)
- [ ] `tests/unit/lib/branch-template.test.ts` — stubs for GIT-03 (interpolateBranchTemplate)

*Existing test files may cover asset-actions and search-actions partially.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Settings UI sections render with correct inputs | SYS-01,SYS-02,GIT-03,GIT-04,SRCH-05 | Visual layout verification | Open Settings > Config, verify System/Git/Search sections visible with correct input controls |
| Config values persist across page reload | All | Browser state verification | Change a value, save, refresh page, verify value persists |
| Upload rejection at new limit | SYS-01 | File size testing in browser | Set upload limit to 1 MB, try uploading a 2 MB file |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
