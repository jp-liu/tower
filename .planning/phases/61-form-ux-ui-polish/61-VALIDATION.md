---
phase: 61
slug: form-ux-ui-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 61 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (project-standard) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test:run` |
| **Full suite command** | `pnpm test:run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:run`
- **After every plan wave:** Run `pnpm test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| T1 | 01 | 1 | FORM-01 | unit/component | `pnpm test:run -- create-project` | ❌ | pending |
| T2 | 01 | 1 | FORM-02 | unit/component | `pnpm test:run -- import-project` | ❌ | pending |
| T3 | 01 | 1 | FORM-03 | unit/component | `pnpm test:run -- import-project` | ❌ | pending |
| T4 | 01 | 1 | FORM-04 | unit/component | `pnpm test:run -- create-project` | ❌ | pending |
| T5 | 01 | 1 | FORM-05 frontend | unit/component | `pnpm test:run -- create-project` | ❌ | pending |
| T6 | 01 | 1 | FORM-05 backend | integration | `pnpm test:run -- git` | ❌ | pending |
| T7 | 01 | 1 | UI-01 | unit/component | `pnpm test:run -- top-bar` | ❌ | pending |

---

## Wave 0 Requirements

Component test infrastructure for React components is NOT confirmed in the project.
If component tests cannot run, validation falls back to manual visual inspection + existing action/hook tests.

---

## Acceptance Threshold

- All automated tests pass (`pnpm test:run` exits 0)
- No dialog grows beyond viewport height
- No browse button visible in create-project form
- Bot icon appears immediately after search button in DOM order
