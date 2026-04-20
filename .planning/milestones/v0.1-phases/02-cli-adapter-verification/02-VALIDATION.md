---
phase: 2
slug: cli-adapter-verification
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-26
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + @testing-library/react (unit), pnpm tsc --noEmit (type check) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test:run tests/unit/components/cli-adapter-tester.test.tsx` |
| **Full suite command** | `pnpm test:run && pnpm tsc --noEmit` |
| **Estimated runtime** | ~10 seconds (unit tests + type check) |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | CLIV-03 | unit + type | `grep -n "claude_version" src/lib/adapters/claude-local/test.ts && pnpm tsc --noEmit 2>&1 \| tail -3` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | CLIV-01..04 | structural | `grep -c "it(" tests/unit/components/cli-adapter-tester.test.tsx && grep -q "mockPassingResult" tests/unit/components/cli-adapter-tester.test.tsx && echo SCAFFOLD_OK` | ✅ (Wave 0) | ⬜ pending |
| 02-02-01 | 02 | 2 | CLIV-01..04 | unit + type | `pnpm test:run tests/unit/components/cli-adapter-tester.test.tsx && pnpm tsc --noEmit 2>&1 \| tail -5` | ✅ | ⬜ pending |
| 02-02-02 | 02 | 2 | D-04 | grep + type | `grep -n "CLIAdapterTester" src/app/settings/page.tsx && pnpm tsc --noEmit 2>&1 \| tail -3` | ✅ | ⬜ pending |
| 02-02-03 | 02 | 2 | visual | checkpoint | `pnpm test:run 2>&1 \| tail -5` (automated baseline) + human-verify | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- **Test scaffold:** Plan 01, Task 2 creates `tests/unit/components/cli-adapter-tester.test.tsx` with 7 test cases (RED until Plan 02 Task 1 creates the component)
- **Type checking:** `pnpm tsc --noEmit` is used across both plans to confirm compilation
- No additional test framework installation needed — Vitest and @testing-library/react already configured

*Wave 0 is satisfied by Plan 01 Task 2 (test scaffold).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual layout and color adaptation | D-01 | CSS/theme rendering | Open Settings > AI Tools, check card styling in light and dark mode |
| i18n labels render correctly in both locales | i18n | Runtime locale switching | Switch language in General settings, verify AI Tools labels update |
| Loading spinner animation is visible | CLIV-04 | Animation rendering | Click Test Connection, observe spinner during loading |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Plan 01 Task 2 creates test scaffold)
- [x] No watch-mode flags
- [x] Feedback latency < 50s (estimated ~10s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
