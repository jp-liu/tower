---
phase: 5
slug: mcp-knowledge-tools
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 5 — Validation Strategy

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
| 05-01-01 | 01 | 1 | PROJ-01, PROJ-02, PROJ-03 | unit | `pnpm vitest run tests/unit/mcp/identify-project.test.ts` | plan creates | ⬜ pending |
| 05-02-01 | 02 | 2 | NOTE-04 | unit | `pnpm vitest run tests/unit/mcp/manage-notes.test.ts` | plan creates | ⬜ pending |
| 05-02-02 | 02 | 2 | ASST-03 | unit | `pnpm vitest run tests/unit/mcp/manage-assets.test.ts` | plan creates | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/mcp/` — test directory structure
- [ ] Test stubs for all MCP tool requirement IDs

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| MCP tool count ≤ 30 | Constraint | Requires running MCP server and listing tools | Start MCP server, call `tools/list`, count entries |
| identify_project confidence scoring with real data | PROJ-02 | Threshold tuning needs real project names | Create projects with similar names, verify ranking |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
