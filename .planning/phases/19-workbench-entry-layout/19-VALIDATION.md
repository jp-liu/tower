---
phase: 19
slug: workbench-entry-layout
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-31
---

# Phase 19 — Validation Strategy

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
| 19-01-01 | 01 | 1 | WB-01 | component | `pnpm vitest run task-detail-panel` | ✅ | ⬜ pending |
| 19-01-02 | 01 | 1 | WB-02 | component | `pnpm vitest run task-page-client` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. vitest is already configured. Component tests for task-detail-panel and task-page-client exist.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tab switching preserves chat scroll position | WB-02 | Scroll position is a browser-level behavior not testable in jsdom | 1. Open task page 2. Scroll chat 3. Switch tabs 4. Verify scroll position preserved |
| Resizable panels drag interaction | WB-02 | Drag handle requires pointer events not available in jsdom | 1. Open task page 2. Drag resize handle 3. Verify panels resize with min 20% constraint |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
