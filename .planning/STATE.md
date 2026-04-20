---
gsd_state_version: 1.0
milestone: v0.95
milestone_name: Pre-Release Hardening
status: verifying
stopped_at: Completed 54-01-PLAN.md
last_updated: "2026-04-20T10:01:16.216Z"
last_activity: 2026-04-20
progress:
  total_phases: 15
  completed_phases: 8
  total_plans: 18
  completed_plans: 18
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20)

**Core value:** Users can organize, track, and execute AI-assisted tasks through a visual Kanban board with direct AI agent integration, backed by a per-project knowledge base.
**Current focus:** Phase 54 — error-handling-refactoring

## Current Position

Phase: 54
Plan: Not started
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
- [Phase 50]: Mock path for MCP db is ../../db (not ../db) since test is in tools/__tests__/ subdir
- [Phase 50]: Mock path from __tests__/ is ../../db (not ../db) — __tests__ is a subdirectory of tools/, so db.ts is two levels up
- [Phase 50]: global.fetch must be assigned before imports to intercept bridgeFetch in terminal-tools MCP handler tests
- [Phase 50-mcp-tools-test-coverage]: // @vitest-environment node required for MCP tool tests mocking Node.js built-ins (fs, child_process) — jsdom prevents mock interception
- [Phase 50-mcp-tools-test-coverage]: vi.mock path from tools/__tests__/ must be ../../db (not ../db) to resolve to src/mcp/db.ts
- [Phase 51-core-lib-test-coverage]: vi.hoisted() used for mockFindUnique in config-reader tests — avoids Cannot access before initialization from vi.mock hoisting
- [Phase 51-core-lib-test-coverage]: Logger does NOT scrub sensitive fields — COV-23 documents current behavior via assertions, scrubbing is a future enhancement
- [Phase 51-core-lib-test-coverage]: Test captureExecutionSummary end-to-end with mocked dependencies rather than extracting private functions — avoids refactoring and exercises all internal logic indirectly
- [Phase 51-core-lib-test-coverage]: [Phase 51-core-lib]: jsdom environment for localStorage tests, node environment for Node.js built-in mocking — set per test file via // @vitest-environment directive
- [Phase 51-core-lib-test-coverage]: checkConflicts (git binary) excluded from tests — only pure parseDiffOutput tested
- [Phase 51-core-lib-test-coverage]: resolveAssetPath allows single-level traversal within data/assets/ — guard only blocks escape outside data/assets/
- [Phase 52-hooks-logic-extraction]: URL.createObjectURL patched as property on URL class (not vi.stubGlobal) to preserve jsdom constructor behavior
- [Phase 52-hooks-logic-extraction]: idGenerator injected into applySSEEvent for deterministic IDs in tests; sessionId handling kept in hook as React ref side effect
- [Phase 53-e2e-tests]: Context menu uses plain button elements in createPortal at z-index 9999; NO_PROXY required to bypass http_proxy for localhost in Playwright tests
- [Phase 53]: Test 0 setup pattern: switches assistant to chat mode via settings UI before flow tests — avoids hard-coding config state
- [Phase 53]: Response test uses test.slow() + 120s timeout accepting either assistant bubble or thinking indicator — graceful handling of missing Claude SDK credentials
- [Phase 54]: as-any casts were stale artifacts: Prisma Task type already includes baseBranch/subPath since Phase 15; DiffData type already declared branchDeleted — all three casts unnecessary
- [Phase 54]: zh.ts uses as const (source of truth for TranslationKey); en.ts uses Translations type enforcing key parity at compile time

### Pending Todos

None yet.

### Blockers/Concerns

None at roadmap stage.

## Session Continuity

Last session: 2026-04-20T09:58:58.857Z
Stopped at: Completed 54-01-PLAN.md
Resume file: None
