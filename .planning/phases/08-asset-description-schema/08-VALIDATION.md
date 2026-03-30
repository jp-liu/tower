---
phase: 8
slug: asset-description-schema
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-30
---

# Phase 8 — Validation Strategy

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
| 08-01-01 | 01 | 1 | ASSET-02 | unit | `pnpm vitest run tests/unit/lib/asset-actions.test.ts` | Yes | ⬜ pending |
| 08-01-02 | 01 | 1 | ASSET-01 | unit | `pnpm vitest run tests/unit/components/assets/asset-upload.test.tsx` | Yes (created in Task 2) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*No Wave 0 gaps remain. Task 2 of Plan 01 creates `tests/unit/components/assets/asset-upload.test.tsx` as part of its action, covering the ASSET-01 behavioral requirements (textarea renders, submit disabled on empty description, description state works).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Upload dialog description field visible | ASSET-01 | Visual UI check | Open upload dialog, verify description textarea appears |
| Existing assets display without error | ASSET-02 | Data migration check | Load assets page, verify pre-existing assets show empty description |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
