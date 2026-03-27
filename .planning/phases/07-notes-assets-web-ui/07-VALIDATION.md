---
phase: 7
slug: notes-assets-web-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm vitest run --reporter=verbose` |
| **Full suite command** | `pnpm vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --reporter=verbose`
- **After every plan wave:** Run `pnpm vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | UI-01 | unit | `pnpm vitest run tests/unit/components/notes-page.test.ts` | plan creates | ⬜ pending |
| 07-01-02 | 01 | 1 | UI-02 | unit | `pnpm vitest run tests/unit/components/assets-page.test.ts` | plan creates | ⬜ pending |
| 07-01-03 | 01 | 1 | UI-01, UI-02 | grep | `grep -r "notes\." src/lib/i18n.tsx && grep -r "assets\." src/lib/i18n.tsx` | existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `@uiw/react-md-editor` — install and verify SSR compatibility
- [ ] `tests/unit/components/` — test directory structure

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Notes page renders with category filter | UI-01 | Visual layout check | Open notes page, select category, verify filtered list |
| Markdown editor renders formatted output | UI-01 | Visual rendering | Create note with markdown, verify formatted preview |
| Assets page shows uploaded files | UI-02 | Visual file list | Open assets page, verify file names and sizes displayed |
| i18n strings display in both languages | UI-01, UI-02 | Visual language switch | Toggle language, verify all new strings update |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
