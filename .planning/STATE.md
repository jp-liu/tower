---
gsd_state_version: 1.0
milestone: v0.95
milestone_name: Pre-Release Hardening
status: executing
stopped_at: Completed 47-01-PLAN.md
last_updated: "2026-04-20T06:31:38.394Z"
last_activity: 2026-04-20
progress:
  total_phases: 15
  completed_phases: 0
  total_plans: 2
  completed_plans: 1
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20)

**Core value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.
**Current focus:** Phase 47 — failing-test-fixes

## Current Position

Phase: 47 (failing-test-fixes) — EXECUTING
Plan: 2 of 2
Status: Ready to execute
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

### Pending Todos

None yet.

### Blockers/Concerns

None at roadmap stage.

## Session Continuity

Last session: 2026-04-20T06:31:38.391Z
Stopped at: Completed 47-01-PLAN.md
Resume file: None
