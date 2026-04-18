---
phase: 41
slug: paste-ux-thumbnail-strip
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 41 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test:run --reporter=verbose` |
| **Full suite command** | `pnpm test:run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:run --reporter=verbose`
- **After every plan wave:** Run `pnpm test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 41-01-01 | 01 | 1 | PASTE-01, PASTE-04, PASTE-05, PASTE-06 | unit | `pnpm test:run tests/unit/hooks/use-image-upload.test.ts` | ❌ W0 | ⬜ pending |
| 41-01-02 | 01 | 1 | PASTE-07 | type-check | `npx tsc --noEmit src/components/assistant/assistant-chat.tsx` | ✅ | ⬜ pending |
| 41-02-01 | 02 | 1 | PASTE-01, PASTE-02 | unit | `pnpm test:run tests/unit/components/image-thumbnail-strip.test.tsx` | ❌ W0 | ⬜ pending |
| 41-02-02 | 02 | 1 | PASTE-03 | unit | `pnpm test:run tests/unit/components/image-preview-modal.test.tsx` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/hooks/use-image-upload.test.ts` — stubs for PASTE-01, PASTE-04, PASTE-05, PASTE-06
- [ ] `tests/unit/components/image-thumbnail-strip.test.tsx` — stubs for PASTE-01, PASTE-02
- [ ] `tests/unit/components/image-preview-modal.test.tsx` — stubs for PASTE-03

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Image paste in browser | PASTE-01, PASTE-06 | Requires real browser clipboard API | Paste image in chat, verify upload triggers and thumbnail appears |
| Progress bar animation | PASTE-02 | Visual animation verification | Paste large image, observe progress bar updates |
| Preview modal zoom | PASTE-03 | Visual interaction | Click thumbnail, verify zoom toggle works |
| Firefox compatibility | PASTE-06 | Browser-specific behavior | Test in Firefox, verify clipboardData.items works |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
