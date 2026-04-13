# Deferred Items — Phase 35.1

## Pre-existing TypeScript Errors (Out of Scope)

These errors existed before Phase 35.1 and are not related to the mission files.

### src/actions/agent-config-actions.ts (lines 25, 37)
- Prisma InputJsonValue type mismatch for `settings` field
- Pre-existing since Prisma schema migration in Phase 30

### tests/unit/lib/pty-session.test.ts (lines 30, 99, 100)
- `addExitListener` method does not exist on `PtySession` (correct name is `setExitListener`)
- Mock type mismatch at line 30
- Pre-existing test issues, not related to Mission Control

## Pre-existing Test Failures (Out of Scope)

27 pre-existing test failures documented in Plan 02 SUMMARY remain unchanged:
- tests/unit/actions/preview-actions.test.ts (1 failure)
- tests/unit/components/asset-item.test.tsx
- tests/unit/components/board-stats.test.tsx
- tests/unit/components/create-task-dialog.test.tsx
- tests/unit/components/prompts-config.test.tsx
- tests/unit/lib/instrumentation.test.ts
- tests/unit/lib/preview-process-manager.test.ts
- tests/unit/lib/pty-session.test.ts
