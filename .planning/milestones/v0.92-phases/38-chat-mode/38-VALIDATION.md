---
phase: 38
slug: chat-mode
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-17
---

# Phase 38 — Validation Strategy

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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 38-01-01 | 01 | 1 | CM-01 | structural | `grep -c "stripAnsi\|parseSegment\|useAssistantChat" src/hooks/use-assistant-chat.ts` | ⬜ pending |
| 38-01-02 | 01 | 1 | CM-02 | structural | `grep -c "ReactMarkdown\|remarkGfm" src/components/assistant/assistant-chat.tsx` | ⬜ pending |
| 38-01-03 | 01 | 1 | CM-03, CM-04 | structural | `grep -c "textarea\|handleSend\|thinking" src/components/assistant/assistant-chat.tsx` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*No Wave 0 test stubs needed — Phase 38 is primarily UI components verified via structural grep and manual smoke testing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Claude CLI output parsed into chat bubbles | CM-01 | Requires live PTY session | 1. Open assistant in chat mode 2. Send a message 3. Verify response appears as Markdown bubble |
| Markdown tables/lists/code render correctly | CM-02 | Visual rendering | 1. Ask assistant to show a table 2. Verify table renders with proper formatting |
| Enter sends, Shift+Enter newline | CM-03 | Keyboard interaction | 1. Type in input 2. Press Enter 3. Verify sent 4. Press Shift+Enter 5. Verify newline |
| Thinking indicator visible during processing | CM-04 | Animation check | 1. Send message 2. Verify pulsing dots appear 3. Verify they disappear when response completes |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or checkpoint verification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
