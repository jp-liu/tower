---
phase: 14
slug: search-quality-realtime-config
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-30
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.1 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm test:run tests/unit/lib/search.test.ts tests/unit/actions/search-actions.test.ts tests/unit/mcp/search-tools.test.ts tests/unit/components/search-dialog.test.tsx` |
| **Full suite command** | `pnpm test:run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command (phase-relevant tests)
- **After every plan wave:** Run `pnpm test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | SRCH-06 | unit | `pnpm test:run tests/unit/lib/search.test.ts` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | SRCH-06 | unit | `pnpm test:run tests/unit/actions/search-actions.test.ts` | ✅ | ⬜ pending |
| TBD | 01 | 1 | SRCH-06 | unit | `pnpm test:run tests/unit/mcp/search-tools.test.ts` | ✅ | ⬜ pending |
| TBD | 02 | 1 | SRCH-07 | unit | `pnpm test:run tests/unit/components/search-dialog.test.tsx` | ✅ | ⬜ pending |
| TBD | 02 | 1 | CFG-02 | unit | `pnpm test:run tests/unit/components/search-dialog.test.tsx` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/lib/search.test.ts` — covers SRCH-06 (verify extracted module returns same results; verify config params respected: resultLimit, allModeCap, snippetLength)

*Existing infrastructure covers SRCH-07 and CFG-02 once new test cases are added to search-dialog.test.tsx.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Config change takes effect without restart | CFG-02 | Requires browser interaction | 1. Open search dialog, note debounce speed. 2. Change search.debounceMs in settings. 3. Close and re-open search dialog. 4. Verify debounce speed changed. |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
