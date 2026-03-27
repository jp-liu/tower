---
phase: 4
slug: data-layer-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (if exists, else Wave 0 installs) |
| **Quick run command** | `pnpm vitest run --reporter=verbose` |
| **Full suite command** | `pnpm vitest run --reporter=verbose` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --reporter=verbose`
- **After every plan wave:** Run `pnpm vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | NOTE-01 | unit | `pnpm vitest run src/lib/__tests__/note-actions.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | NOTE-02 | unit | `pnpm vitest run src/lib/__tests__/note-categories.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | NOTE-03 | unit | `pnpm vitest run src/lib/__tests__/fts.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | ASST-01 | unit | `pnpm vitest run src/lib/__tests__/asset-actions.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | ASST-02 | unit | `pnpm vitest run src/lib/__tests__/file-utils.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` — install if not already a dependency
- [ ] `src/lib/__tests__/` — test directory structure
- [ ] Test stubs for all requirement IDs

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| FTS5 Chinese tokenization | NOTE-03 | Trigram tokenizer behavior varies by SQLite build | Query "笔记内容" after inserting Chinese text, verify results returned |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
