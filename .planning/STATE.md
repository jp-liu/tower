---
gsd_state_version: 1.0
milestone: v0.95
milestone_name: Pre-Release Hardening
status: verifying
stopped_at: Completed 49-01-PLAN.md
last_updated: "2026-04-20T07:05:18.374Z"
last_activity: 2026-04-20
progress:
  total_phases: 15
  completed_phases: 3
  total_plans: 6
  completed_plans: 6
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20)

**Core value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.
**Current focus:** Phase 49 — server-actions-test-coverage

## Current Position

Phase: 49 (server-actions-test-coverage) — EXECUTING
Plan: 3 of 3
Status: Phase complete — ready for verification
Last activity: 2026-04-20

Progress: [░░░░░░░░░░] 0%

## Phase Overview

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 47 | Failing Test Fixes | TEST-01~06 | Not started |
| 48 | Security Hardening & Guard Tests | SEC-01, COV-14 | Not started |
| 49 | Server Actions Test Coverage | COV-01~07 | Not started |
| 50 | MCP Tools Test Coverage | COV-08~13 | Not started |
| 51 | Core Lib Test Coverage | COV-15~17, COV-20~23 | Not started |
| 52 | Hooks & Logic Extraction | COV-18~19 | Not started |
| 53 | E2E Tests | E2E-01~03 | Not started |
| 54 | Error Handling & Refactoring | ERR-01, REF-01~02 | Not started |

## Performance Metrics

**Velocity:**

- Total plans completed: 0 (this milestone)
- Average duration: —
- Total execution time: —

## Accumulated Context

### Decisions

- v0.95 is pre-v1.0 hardening: no new features, focus on tests/security/robustness
- 27 failing tests across 8 files must be fixed first (Phase 47) before coverage work begins
- SEC-01 grouped with COV-14 (internal-api-guard) in Phase 48 — security fix + its test coverage together
- COV-15~17 and COV-20~23 batched into Phase 51 (7 requirements, all core lib modules)
- i18n.tsx split (REF-01) deferred to final phase to avoid merge conflicts during test phases
- [Phase 47-failing-test-fixes]: Use setExitListener (not addExitListener) in pty-session test — API changed to replace semantics
- [Phase 47-failing-test-fixes]: instrumentation.test.ts mocks @/lib/instrumentation-tasks module boundary directly, not child_process/db
- [Phase 47]: Component tests need vi.mock hoisting before imports for next/navigation; icon-only buttons need title attributes for accessible names
- [Phase 48-security-hardening-guard-tests]: validateProjectId added to internal-api-guard.ts to co-locate all CUID guard logic; validates before any FS access in asset route
- [Phase 49]: mockTx defined before vi.mock to avoid hoisting order issues in vitest
- [Phase 49]: callOrder array used to verify updateMany executes before update in setDefaultPrompt transaction
- [Phase 49-server-actions-test-coverage]: Date range filter tests: use getTime() diff (24h) instead of ISO string prefix to avoid TZ-dependent failures
- [Phase 49-server-actions-test-coverage]: vi.mock hoisting before imports ensures db mock is in scope when action modules load
- [Phase 49-server-actions-test-coverage]: deleteNote call-order verified via array push in mockImplementation — FTS cleanup before DB delete

### Pending Todos

None yet.

### Blockers/Concerns

None at roadmap stage.

## Session Continuity

Last session: 2026-04-20T07:05:18.371Z
Stopped at: Completed 49-01-PLAN.md
Resume file: None
