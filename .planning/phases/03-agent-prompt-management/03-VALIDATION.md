---
phase: 3
slug: agent-prompt-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + @testing-library/react (unit), pnpm tsc --noEmit (type check) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test:run tests/unit/components/prompts-config.test.tsx` |
| **Full suite command** | `pnpm test:run && pnpm tsc --noEmit` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | PMPT-01 | unit | `grep -n "setDefaultPrompt" src/actions/prompt-actions.ts && pnpm tsc --noEmit 2>&1 \| tail -3` | ✅ | ⬜ pending |
| 03-01-02 | 01 | 1 | PMPT-05 | unit | `grep -c "it(" tests/unit/components/prompts-config.test.tsx && echo SCAFFOLD_OK` | ✅ (Wave 0) | ⬜ pending |
| 03-02-01 | 02 | 2 | PMPT-01..04 | unit | `pnpm test:run tests/unit/components/prompts-config.test.tsx && pnpm tsc --noEmit 2>&1 \| tail -5` | ✅ | ⬜ pending |
| 03-02-02 | 02 | 2 | UI | visual | Manual — prompt list, create/edit dialog, delete confirmation | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- **Test scaffold:** Plan 01, Task 2 creates `tests/unit/components/prompts-config.test.tsx` with test cases for CRUD operations
- **Type checking:** `pnpm tsc --noEmit` confirms all TypeScript compiles
- No additional test framework installation needed — Vitest already configured

*Wave 0 is satisfied by Plan 01 Task 2 (test scaffold).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Create dialog opens and saves prompt | PMPT-01 | Dialog interaction | Open Settings > Prompts, click Create, fill form, verify prompt appears in list |
| Edit dialog pre-fills existing data | PMPT-02 | Dialog + form | Click edit on a prompt, verify name/description/content pre-filled |
| Delete confirmation shows before removal | PMPT-03 | Dialog interaction | Click delete, verify confirmation dialog, confirm removal |
| Default star badge visible on default prompt only | PMPT-04, PMPT-05 | Visual + functional | Set prompt A as default, verify star badge; set prompt B as default, verify A loses star |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
