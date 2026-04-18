---
phase: 40
slug: image-upload-api
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 40 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test:run --reporter=verbose` |
| **Full suite command** | `pnpm test:run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:run --reporter=verbose`
- **After every plan wave:** Run `pnpm test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 40-01-01 | 01 | 1 | CACHE-02 | unit | `pnpm test:run tests/unit/mime-magic.test.ts` | ❌ W0 | ⬜ pending |
| 40-01-02 | 01 | 1 | CACHE-01, CACHE-03 | unit | `pnpm test:run tests/unit/file-utils.test.ts` | ✅ | ⬜ pending |
| 40-02-01 | 02 | 1 | CACHE-01, CACHE-02, CACHE-03 | integration | `pnpm test:run tests/unit/assistant-images-route.test.ts` | ❌ W0 | ⬜ pending |
| 40-03-01 | 03 | 2 | CACHE-04 | integration | `pnpm test:run tests/unit/cache-route.test.ts` | ❌ W0 | ⬜ pending |
| 40-03-02 | 03 | 2 | CACHE-05 | integration | `pnpm test:run tests/unit/assets-route.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/mime-magic.test.ts` — stubs for CACHE-02 magic byte validation
- [ ] `tests/unit/assistant-images-route.test.ts` — stubs for CACHE-01, CACHE-02, CACHE-03 upload endpoint
- [ ] `tests/unit/cache-route.test.ts` — stubs for CACHE-04 cached image serving
- [ ] `tests/unit/assets-route.test.ts` — stubs for CACHE-05 asset serving

*Existing `tests/unit/file-utils.test.ts` covers file-utils helpers.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Browser paste uploads file correctly | CACHE-01 | Requires real browser clipboard API | Paste an image in chat input, verify upload succeeds |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
