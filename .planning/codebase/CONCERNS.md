# Codebase Concerns

**Analysis Date:** 2026-03-26

## Tech Debt

**Files with `@ts-nocheck` and `eslint-disable`:**
- Issue: Three major component files entirely bypass TypeScript and ESLint checks
- Files: `src/components/repository/repo-sidebar.tsx`, `src/components/layout/folder-browser-dialog.tsx`, `src/components/layout/app-sidebar.tsx`
- Impact: Type errors and lint violations hidden; bugs can slip through undetected. `repo-sidebar.tsx` is 800 lines — the largest source file in the project — making this especially risky.
- Fix approach: Remove `@ts-nocheck` / `eslint-disable` directives, fix underlying type errors, and break `repo-sidebar.tsx` into smaller components (e.g., GitInfoPanel, FileBrowser, ProjectEditDialog).

**Unsafe `as any` casts for task labels:**
- Issue: Task labels are accessed via `(task as any).labels` because the `Task` Prisma type does not include the relation
- Files: `src/components/board/task-card.tsx` (lines 92-106), `src/app/workspaces/[workspaceId]/board-page-client.tsx` (lines 183-184)
- Impact: No type safety on label rendering; runtime errors if the shape changes. Editor tooling cannot autocomplete or catch mistakes.
- Fix approach: Define an extended type like `TaskWithLabels = Task & { labels: (TaskLabel & { label: Label })[] }` in `src/types/` and use it throughout the board components.

**Duplicated validation logic across execute and stream routes:**
- Issue: `src/app/api/tasks/[taskId]/execute/route.ts` and `src/app/api/tasks/[taskId]/stream/route.ts` both independently validate request body, check task existence, verify localPath, check running executions, and check concurrent limits.
- Files: `src/app/api/tasks/[taskId]/execute/route.ts`, `src/app/api/tasks/[taskId]/stream/route.ts`
- Impact: Logic drift between the two routes; maintenance burden doubles. Changes to validation rules must be applied in two places.
- Fix approach: Extract shared validation into a utility module (e.g., `src/lib/adapters/validate-execution.ts`) and import it from both routes.

**Server actions lack input validation:**
- Issue: Server actions in `src/actions/` accept raw parameters without Zod validation. For example, `createTask` trusts `data.projectId` without verifying it is a valid cuid. `deleteLabel` does not check `isBuiltin` before deleting.
- Files: `src/actions/task-actions.ts`, `src/actions/workspace-actions.ts`, `src/actions/label-actions.ts`, `src/actions/agent-actions.ts`
- Impact: Builtin labels can be deleted (violating documented constraint). Invalid or malicious IDs passed from the client are sent directly to Prisma, risking unclear database errors.
- Fix approach: Add Zod schemas to each server action. Add an `isBuiltin` guard to `deleteLabel`. The MCP `label-tools.ts` has the same missing guard at line 47.

**Non-transactional label replacement in server actions:**
- Issue: `setTaskLabels` in `src/actions/label-actions.ts` performs `deleteMany` then `createMany` as two separate operations, not wrapped in a transaction. If the second operation fails, labels are lost.
- Files: `src/actions/label-actions.ts` (lines 43-52)
- Impact: Data loss on partial failure. The MCP version (`src/mcp/tools/label-tools.ts` line 59) correctly uses `db.$transaction` — the server action should match.
- Fix approach: Wrap the delete+create in `db.$transaction()` like the MCP tool does.

## Security Considerations

**Command injection via git API route:**
- Risk: The `POST /api/git` route passes user-supplied `branch` and `url` values into `execSync` commands. While `branch` is sanitized with a regex and `url` is wrapped in `JSON.stringify`, the `baseBranch` parameter (line 172) and the `branch` in the checkout action (lines 152-153) are passed without sanitization.
- Files: `src/app/api/git/route.ts` (lines 113, 152-153, 174)
- Current mitigation: `JSON.stringify` wrapping on clone URL; regex sanitization on `create-branch`; 5-10 second timeouts on execSync.
- Recommendations: Use `execFile` or `spawn` with argument arrays instead of `execSync` with string interpolation. Validate all inputs against strict patterns (e.g., branch names must match `^[a-zA-Z0-9_\-/.]+$`). Never pass user input into shell commands as concatenated strings.

**Filesystem traversal via browse-fs API:**
- Risk: The `GET /api/browse-fs` endpoint allows browsing any directory on the server filesystem. An attacker can enumerate directories, discover sensitive paths, and map the system layout.
- Files: `src/app/api/browse-fs/route.ts`
- Current mitigation: Only directories are listed (not files); dotfiles are filtered. No authentication is required.
- Recommendations: Restrict browsing to a configurable allowlist of base directories (e.g., user home, project roots). Add authentication/authorization if this app is ever exposed beyond localhost.

**No authentication or authorization:**
- Risk: All API routes and server actions are publicly accessible. Any client on the network can create/delete workspaces, execute agent commands, and browse the filesystem.
- Files: All routes under `src/app/api/`, all server actions under `src/actions/`
- Current mitigation: App is presumably intended for local use only.
- Recommendations: Document the localhost-only assumption clearly. If multi-user or remote access is planned, add authentication middleware and authorization checks.

**No rate limiting on API endpoints:**
- Risk: The agent execution endpoints (`/api/tasks/[taskId]/stream`, `/api/tasks/[taskId]/execute`) spawn child processes. Without rate limiting, an attacker can exhaust system resources.
- Files: `src/app/api/tasks/[taskId]/stream/route.ts`, `src/app/api/tasks/[taskId]/execute/route.ts`
- Current mitigation: `MAX_CONCURRENT = 3` limit in `src/lib/adapters/process-manager.ts` (line 3), but no per-client throttling.
- Recommendations: Add request-level rate limiting middleware for process-spawning endpoints.

## Performance Bottlenecks

**Over-fetching in workspace queries:**
- Problem: `getWorkspaces()` includes ALL projects with ALL tasks and ALL repositories for every workspace. The root layout also queries all workspaces on every page load.
- Files: `src/actions/workspace-actions.ts` (lines 7-17), `src/app/layout.tsx` (lines 33-36), `src/app/workspaces/[workspaceId]/page.tsx` (lines 14-35)
- Cause: Deep `include` chains load the entire object graph. As workspaces grow with many projects and tasks, this becomes progressively slower.
- Improvement path: Use selective includes. For the sidebar, only load workspace names. For the board page, only load tasks for the selected project. Consider pagination for task lists.

**Synchronous `execSync` calls in git route:**
- Problem: The git API route uses `execSync` which blocks the Node.js event loop for every git operation (branch listing, status, clone).
- Files: `src/app/api/git/route.ts` (13 `execSync` calls)
- Cause: `execSync` is synchronous and blocks the entire server thread.
- Improvement path: Replace `execSync` with `execFile` (promisified) or `spawn` with async handling. The adapter layer already uses `spawn` correctly in `src/lib/adapters/process-utils.ts`.

**SQLite as the database engine:**
- Problem: SQLite is a single-writer database. Concurrent writes (e.g., multiple agent executions updating status simultaneously) will cause `SQLITE_BUSY` errors under load.
- Files: `prisma/schema.prisma` (datasource block)
- Cause: SQLite design limitation for concurrent access.
- Improvement path: Acceptable for single-user local use. For multi-user or high-concurrency scenarios, migrate to PostgreSQL. Prisma makes this a config change if queries stay compatible.

## Fragile Areas

**In-memory process tracking:**
- Files: `src/lib/adapters/process-manager.ts`, `src/lib/adapters/process-utils.ts`
- Why fragile: Process state is stored in module-level `Map` objects (`runningProcesses`, `executionToRunId`). If the Next.js server restarts or hot-reloads during development, all tracking is lost. Executions marked as RUNNING in the database will never be cleaned up, creating phantom "running" records.
- Safe modification: Always update the database status before relying on in-memory maps. Add a startup reconciliation step that marks stale RUNNING executions as FAILED.
- Test coverage: No tests exist for process-manager or process-utils.

**Board store date filtering:**
- Files: `src/stores/board-store.ts` (lines 39-44)
- Why fragile: `getTasksByStatus` filters DONE/CANCELLED tasks by `new Date(t.updatedAt) >= today`, but `t.updatedAt` comes from the server as a string (not a Date object) after serialization. The `new Date()` constructor may parse it differently across environments.
- Safe modification: Ensure date comparison uses consistent parsing. Consider moving this filter to the server query.
- Test coverage: No tests for board-store.

**SSE stream error handling:**
- Files: `src/app/api/tasks/[taskId]/stream/route.ts` (lines 228-243)
- Why fragile: If the database update in the catch block fails (`.catch(() => {})`), the execution record remains stuck in RUNNING status permanently. The outer catch on line 266 returns a generic "Stream failed" error with no details.
- Safe modification: Log database update failures. Add a cleanup mechanism for stuck executions.
- Test coverage: No tests for the stream route.

## Scaling Limits

**Concurrent execution cap hardcoded:**
- Current capacity: 3 concurrent agent executions
- Limit: `MAX_CONCURRENT = 3` in `src/lib/adapters/process-manager.ts`
- Scaling path: Make configurable via environment variable. Consider per-workspace or per-project limits.

**No pagination on task/project lists:**
- Current capacity: Works for tens of tasks per project
- Limit: Performance degrades with hundreds of tasks because all tasks for a project are loaded at once (including labels, executions)
- Scaling path: Add cursor-based or offset pagination to `getProjectTasks` and the workspace page query.

## Dependencies at Risk

**`@dnd-kit/core` v6 + `@dnd-kit/sortable` v10 version mismatch:**
- Risk: `@dnd-kit/core` is at v6.3.1 while `@dnd-kit/sortable` is at v10.0.0. These are from different major version lines of the dnd-kit ecosystem, which has undergone significant API changes.
- Impact: Potential runtime incompatibilities or unexpected behavior in drag-and-drop interactions.
- Migration plan: Verify that the installed versions are actually compatible. Consider upgrading `@dnd-kit/core` to match the v10 release line if available.

**Next.js 16.2.1 (bleeding edge):**
- Risk: Next.js 16 is a very recent major version with breaking changes from prior versions. The CLAUDE.md explicitly warns: "This is NOT the Next.js you know."
- Impact: Community resources, Stack Overflow answers, and AI training data may not cover Next.js 16 patterns, increasing the risk of incorrect implementations.
- Migration plan: Pin the version and document any Next.js 16-specific patterns used (e.g., `params` as Promise in route handlers, new component APIs).

**`@base-ui/react` v1.3.0:**
- Risk: Base UI is relatively new and may have breaking changes between minor versions. It is used for low-level UI primitives (dropdown menus, tooltips, dialogs).
- Impact: UI component breakage on upgrades.
- Migration plan: Pin the version. Monitor changelogs before upgrading.

## Test Coverage Gaps

**Minimal test coverage overall:**
- What's not tested: Only 3 test files exist: `tests/unit/components/board-stats.test.tsx` (1 component), `tests/unit/lib/utils.test.ts` (utilities), and `tests/e2e/smoke.spec.ts` (smoke tests).
- Files: All server actions (`src/actions/*.ts`), all API routes (`src/app/api/**`), all adapters (`src/lib/adapters/**`), most components, all stores, MCP server and tools
- Risk: Regressions go undetected. The deletion of builtin labels, the non-transactional label replacement, and the command injection vectors all lack test coverage.
- Priority: High — start with server actions and API routes, especially `src/app/api/git/route.ts` and `src/actions/label-actions.ts`.

**No adapter/execution tests:**
- What's not tested: The entire adapter execution pipeline — process spawning, output parsing, session management, error handling
- Files: `src/lib/adapters/claude-local/execute.ts`, `src/lib/adapters/claude-local/parse.ts`, `src/lib/adapters/process-utils.ts`, `src/lib/adapters/process-manager.ts`
- Risk: Agent execution is a core feature. Untested code paths in process management and output parsing can cause data loss (e.g., stuck executions, lost session IDs).
- Priority: High

**No MCP tool tests:**
- What's not tested: All 18 MCP tools
- Files: `src/mcp/tools/*.ts`, `src/mcp/server.ts`
- Risk: MCP tools are the primary interface for external AI agents. Untested tools may silently return incorrect data or fail.
- Priority: Medium

## Missing Critical Features

**No error boundary components:**
- Problem: No React error boundaries are implemented. A rendering error in any component crashes the entire page.
- Blocks: Graceful error recovery in the UI; user sees a white screen instead of a helpful error message.

**No database migration strategy:**
- Problem: The project uses `prisma db push` for schema changes, which is a prototyping tool, not a production migration strategy. There is no `prisma/migrations/` directory.
- Blocks: Safe schema evolution; rollback capability; team collaboration on schema changes.

**No logging infrastructure:**
- Problem: Only 2 `console.log`/`console.error` calls exist in the entire source. Server actions and API routes silently swallow errors or return generic messages.
- Blocks: Debugging production issues; understanding execution failures; monitoring system health.

**Stale execution cleanup:**
- Problem: If the server crashes while an agent is running, the execution record stays in RUNNING status forever. No mechanism exists to detect and clean up these orphaned records.
- Blocks: Accurate execution status reporting; ability to re-run tasks stuck in "running" state.

---

*Concerns audit: 2026-03-26*
