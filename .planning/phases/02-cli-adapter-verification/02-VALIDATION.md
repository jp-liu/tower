---
phase: 2
slug: cli-adapter-verification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-26
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual verification + `curl` API tests |
| **Config file** | none — no test framework configured |
| **Quick run command** | `curl -s -X POST http://localhost:3000/api/adapters/test -H 'Content-Type: application/json' -d '{"adapterType":"claude-local","cwd":"."}' \| jq .` |
| **Full suite command** | Same as quick run (single adapter) |
| **Estimated runtime** | ~45 seconds (hello probe timeout) |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 50 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | CLIV-03 | unit | `grep 'claude_version' src/lib/adapters/claude-local/test.ts` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | CLIV-01 | integration | `curl -X POST .../api/adapters/test` | ✅ | ⬜ pending |
| 02-02-01 | 02 | 1 | CLIV-01 | visual | Manual — check button renders | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | CLIV-02 | visual | Manual — check results display | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | CLIV-04 | visual | Manual — verify button disabled during test | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing API route infrastructure covers backend requirements
- No test framework installation needed — using curl + manual verification

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Test button renders and triggers API call | CLIV-01 | UI interaction | Open Settings > AI Tools, click "Test Connection", verify loading state appears |
| Per-check pass/fail with messages | CLIV-02 | Visual verification | Run test, verify each check shows icon + message |
| Version displayed when CLI found | CLIV-03 | Visual verification | Run test with claude installed, verify version appears |
| Button disabled during test | CLIV-04 | UI interaction | Click test, immediately click again, verify no duplicate request |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 50s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
