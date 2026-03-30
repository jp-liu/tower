---
phase: 9
slug: search-actions-expansion
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-30
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm vitest run --reporter=verbose` |
| **Full suite command** | `pnpm vitest run --reporter=verbose` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --reporter=verbose`
- **After every plan wave:** Run `pnpm vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | SRCH-01, SRCH-02, SRCH-03 | unit | `pnpm vitest run tests/unit/actions/search-actions.test.ts` | Wave 0 | ⬜ pending |
| 09-01-02 | 01 | 1 | SRCH-04 | unit | `pnpm vitest run tests/unit/mcp/search-tools.test.ts` | Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Task 1 of Plan 01 creates both test scaffolds before any production code is written (TDD RED phase).

| Test File | Requirements Covered | Created By |
|-----------|---------------------|------------|
| `tests/unit/actions/search-actions.test.ts` | SRCH-01, SRCH-02, SRCH-03 | 09-01 Task 1 |
| `tests/unit/mcp/search-tools.test.ts` | SRCH-04 | 09-01 Task 1 |

Both files are authored as the first task of Plan 01 (TDD scaffold). Tests are expected to fail (RED) until Task 2 implements the production code (GREEN).

---

## Manual-Only Verifications

*None — all behaviors have automated test coverage.*

The FTS5 malformed query fallback (SRCH-01) is covered by an automated integration test in `tests/unit/actions/search-actions.test.ts` which calls `globalSearch('"unmatched', "note")` and asserts it resolves without throwing.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
