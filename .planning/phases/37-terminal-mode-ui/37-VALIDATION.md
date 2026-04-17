---
phase: 37
slug: terminal-mode-ui
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `pnpm test:run` |
| **Full suite command** | `pnpm test:run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:run`
- **After every plan wave:** Run `pnpm test:run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 37-01-01 | 01 | 1 | UI-01, UI-02, UI-06 | structural | `grep -c "AssistantProvider" src/components/layout/layout-client.tsx` | — | ⬜ pending |
| 37-01-02 | 01 | 1 | UI-03, UX-02 | structural | `grep -c "push.*layout\|flex.*sidebar" src/components/assistant/assistant-panel.tsx` | — | ⬜ pending |
| 37-01-03 | 01 | 1 | UI-04 | structural | `grep -c "Dialog" src/components/assistant/assistant-panel.tsx` | — | ⬜ pending |
| 37-02-01 | 02 | 2 | TM-01, TM-02, TM-03 | structural | `grep -c "Terminal\|xterm" src/components/assistant/assistant-terminal.tsx` | — | ⬜ pending |
| 37-02-02 | 02 | 2 | UI-01 | structural | `grep -c "Bot\|assistant" src/components/layout/top-bar.tsx` | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*No Wave 0 test stubs needed — Phase 37 is primarily UI components verified via structural grep and manual smoke testing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sidebar push layout does not obstruct main content | UX-02 | Visual layout check | 1. Open assistant sidebar 2. Verify main content area shrinks 3. Verify no overlay blocks interaction with main content |
| Cmd+L toggles assistant panel | UI-02, UI-06 | Keyboard event + DOM check | 1. Press Cmd+L 2. Verify panel opens 3. Press Cmd+L again 4. Verify panel closes and session destroyed |
| xterm.js renders ANSI formatting | TM-03 | Visual rendering | 1. Open assistant 2. Wait for Claude CLI output 3. Verify colors, tables, formatting render correctly |
| Dialog mode centers the panel | UI-04 | Visual layout | 1. Set displayMode to "dialog" in config 2. Open assistant 3. Verify centered modal |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
