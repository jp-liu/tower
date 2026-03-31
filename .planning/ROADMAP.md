# Roadmap: ai-manager

## Milestones

- ✅ **v0.1 Settings** — Phases 1-3 (shipped 2026-03-27)
- ✅ **v0.2 项目知识库 & 智能 MCP** — Phases 4-7 (shipped 2026-03-30)
- ✅ **v0.3 全局搜索增强** — Phases 8-10 (shipped 2026-03-30)
- ✅ **v0.4 系统配置化** — Phases 11-14 (shipped 2026-03-30)
- 🚧 **v0.5 Git Worktree 任务隔离** — Phases 15-18 (in progress)

## Phases

<details>
<summary>✅ v0.1 Settings (Phases 1-3) — SHIPPED 2026-03-27</summary>

- [x] Phase 1: Theme + General Settings (2/2 plans) — completed 2026-03-26
- [x] Phase 2: CLI Adapter Verification (2/2 plans) — completed 2026-03-26
- [x] Phase 3: Agent Prompt Management (2/2 plans) — completed 2026-03-27

See: [milestones/v0.1-ROADMAP.md](./milestones/v0.1-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v0.2 项目知识库 & 智能 MCP (Phases 4-7) — SHIPPED 2026-03-30</summary>

- [x] Phase 4: Data Layer Foundation (2/2 plans) — completed 2026-03-27
- [x] Phase 5: MCP Knowledge Tools (2/2 plans) — completed 2026-03-27
- [x] Phase 6: File Serving & Image Rendering (1/1 plan) — completed 2026-03-27
- [x] Phase 7: Notes & Assets Web UI (2/2 plans) — completed 2026-03-27

See: [milestones/v0.2-ROADMAP.md](./milestones/v0.2-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v0.3 全局搜索增强 (Phases 8-10) — SHIPPED 2026-03-30</summary>

- [x] Phase 8: Asset Description Schema (1/1 plan) — completed 2026-03-30
- [x] Phase 9: Search Actions Expansion (1/1 plan) — completed 2026-03-30
- [x] Phase 10: Search UI Extension (2/2 plans) — completed 2026-03-30

See: [milestones/v0.3-ROADMAP.md](./milestones/v0.3-ROADMAP.md) for full details.

</details>

<details>
<summary>✅ v0.4 系统配置化 (Phases 11-14) — SHIPPED 2026-03-30</summary>

- [x] **Phase 11: SystemConfig Foundation** - SystemConfig model, key-value read/write API, and settings page infrastructure (completed 2026-03-30)
- [x] **Phase 12: Git Path Mapping Rules** - Settings UI for adding/editing/deleting host+owner→localPath rules and auto-match on project creation (completed 2026-03-30)
- [x] **Phase 13: Configurable System Parameters** - Wire upload limit, concurrency cap, git timeout, branch template, and search parameters to SystemConfig (completed 2026-03-30)
- [x] **Phase 14: Search Quality & Realtime Config** - Extract shared search logic, fix race condition, verify realtime config takes effect without restart (completed 2026-03-30)

See: [milestones/v0.4-ROADMAP.md](./milestones/v0.4-ROADMAP.md) for full details.

</details>

### v0.5 Git Worktree 任务隔离 (In Progress)

**Milestone Goal:** 每个任务在独立的 git worktree 中执行，实现并行开发、逐个合并验证、不满意可退回重做。

- [x] **Phase 15: Schema & Cleanup** - Add baseBranch to Task, worktreePath/worktreeBranch to TaskExecution, branch listing API, remove branchTemplate config (completed 2026-03-31)
- [ ] **Phase 16: Worktree Execution Engine** - Auto-create worktree + branch on execution start, switch cwd to worktree, task creation branch selector UI
- [ ] **Phase 17: Review & Merge Workflow** - Task panel diff view, squash merge operation, conflict detection, and revert-to-IN_PROGRESS flow
- [ ] **Phase 18: Worktree Lifecycle** - Auto-cleanup on DONE/CANCELLED, startup prune of orphaned worktrees

## Phase Details

### Phase 11: SystemConfig Foundation
**Goal**: Users have a persistent config store they can read from and write to, and the settings page has a Config section ready to host parameter controls
**Depends on**: Phase 10 (Phases 1-10 complete)
**Requirements**: CFG-01
**Success Criteria** (what must be TRUE):
  1. A `SystemConfig` table exists in the database with key, value, and updatedAt columns
  2. Server actions exist to get a config value by key (with typed default) and set a config value by key
  3. The settings page shows a new Config section (or equivalent navigation entry) — even if empty at this phase
  4. Reading a key that has no stored value returns the declared default without error
**Plans**: 2 plans
Plans:
- [x] 11-01-PLAN.md — SystemConfig model, server actions API, defaults registry, and unit tests
- [x] 11-02-PLAN.md — Settings page Config nav item, placeholder component, page wiring, i18n keys
**UI hint**: yes

### Phase 12: Git Path Mapping Rules
**Goal**: Users can manage Git path mapping rules from the settings page, and those rules auto-apply when a Git URL is entered during project creation
**Depends on**: Phase 11
**Requirements**: GIT-01, GIT-02
**Success Criteria** (what must be TRUE):
  1. User can add a Git path mapping rule specifying host, owner, and a localPath template
  2. User can edit an existing rule and delete a rule from the settings page
  3. When creating a project and entering a Git URL, the localPath field auto-populates by matching the URL against saved rules
  4. Rules are persisted across page reloads and app restarts
**Plans**: 2 plans
Plans:
- [x] 12-01-PLAN.md — GitPathRule type, matchGitPathRule logic, resolveGitLocalPath server action, top-bar async wiring, unit tests
- [x] 12-02-PLAN.md — Settings UI CRUD for Git path mapping rules, i18n keys, visual verification
**UI hint**: yes

### Phase 13: Configurable System Parameters
**Goal**: Users can configure upload size limit, max concurrent executions, Git timeouts, branch naming template, and search parameters through the settings UI — replacing all hardcoded values
**Depends on**: Phase 11
**Requirements**: SYS-01, SYS-02, GIT-03, GIT-04, SRCH-05
**Success Criteria** (what must be TRUE):
  1. User can set the maximum upload file size (replacing the hardcoded 50 MB limit) and uploads beyond the new limit are rejected
  2. User can set the maximum concurrent execution count (replacing the hardcoded 3) and the execution manager respects the new value
  3. User can set the Git operation timeout (clone/status/other) and Git commands use the configured value
  4. User can set the branch naming template (replacing the hardcoded `vk/${taskId}-` prefix) and new task branches follow the template
  5. User can set search result count, All-mode cap, debounce delay, and snippet length, and the search UI applies the configured values
**Plans**: 2 plans
Plans:
- [x] 13-01-PLAN.md — Config defaults registry, branch template utility, server-side consumer wiring, unit tests
- [x] 13-02-PLAN.md — Settings UI sections (System, Git Params, Search), client-side wiring, i18n keys, visual verification
**UI hint**: yes

### Phase 14: Search Quality & Realtime Config
**Goal**: Search logic has no duplication between server actions and MCP tools, the search UI has no race condition, and config changes take effect immediately without restarting the app
**Depends on**: Phase 13
**Requirements**: SRCH-06, SRCH-07, CFG-02
**Success Criteria** (what must be TRUE):
  1. A shared `src/lib/search.ts` module exists and both `search-actions.ts` and `search-tools.ts` delegate to it — no duplicated search logic
  2. Rapidly typing in the search box (changing query before previous result returns) never shows stale results from an earlier query
  3. Changing a config value in settings takes effect in the running app without a server restart or page reload
**Plans**: 2 plans
Plans:
- [x] 14-01-PLAN.md — Extract shared search.ts module, refactor search-actions and search-tools to thin wrappers, unit tests
- [x] 14-02-PLAN.md — Fix search dialog race condition with cancelled flag, move config fetch to open effect, test cases
**UI hint**: no

### Phase 15: Schema & Cleanup
**Goal**: The database schema reflects worktree fields, a branch listing API exists for git projects, and the dead branchTemplate config is removed from the codebase
**Depends on**: Phase 14
**Requirements**: BR-02, WT-03, CL-01
**Success Criteria** (what must be TRUE):
  1. Task records have a `baseBranch` field (nullable string) that is persisted and readable via server actions
  2. TaskExecution records have `worktreePath` and `worktreeBranch` fields (both nullable strings) persisted in the database
  3. A server action or API route returns the list of local git branches for a project given its `localPath`
  4. The branchTemplate field is gone from settings UI, SystemConfig defaults, and all call sites — no reference remains
**Plans**: 2 plans
Plans:
- [ ] 15-01-PLAN.md — Schema migration (baseBranch, worktreePath, worktreeBranch), server action extensions, getProjectBranches action
- [x] 15-02-PLAN.md — branchTemplate cleanup: delete lib + test, clean config-defaults, settings UI, task panel, i18n
**UI hint**: no

### Phase 16: Worktree Execution Engine
**Goal**: When a task starts executing, a dedicated worktree and branch are automatically created, the Claude CLI runs inside that worktree, and multiple tasks in the same project can execute concurrently without conflict
**Depends on**: Phase 15
**Requirements**: BR-01, WT-01, WT-02, WT-04
**Success Criteria** (what must be TRUE):
  1. Creating a task on a GIT-type project shows a base branch selector populated from the project's local git branches
  2. Starting execution on a task automatically creates `{localPath}/.worktrees/task-{taskId}/` with a new branch `task/{taskId}` based on the selected base branch
  3. The TaskExecution record stores the worktree path and branch after creation
  4. Claude CLI receives the worktree directory as its working directory (cwd), not the project root
  5. Two tasks in the same project can be executing simultaneously, each working in their own worktree without file conflicts
**Plans**: 2 plans
Plans:
- [ ] 16-01-PLAN.md — Worktree utility module and stream route integration
- [ ] 16-02-PLAN.md — Branch selector UI in create-task dialog
**UI hint**: yes


### Phase 17: Review & Merge Workflow
**Goal**: After a task execution completes, users can inspect the diff, squash merge to the base branch when satisfied, or send the task back for more work
**Depends on**: Phase 16
**Requirements**: MR-01, MR-02, MR-03, RV-01, RV-02
**Success Criteria** (what must be TRUE):
  1. A completed task transitions to IN_REVIEW status and the task panel shows a diff of changes in the worktree branch vs the base branch
  2. User can trigger a squash merge from the task panel; the worktree branch is squash-merged into the base branch and the task moves to DONE
  3. Before merging, the system checks for conflicts and shows a warning if any exist — merge is blocked until resolved
  4. User can click "Send Back" on an IN_REVIEW task; the task returns to IN_PROGRESS with a new TaskExecution record pointing to the same worktree and branch
  5. After send-back, a subsequent execution resumes in the same `task/{taskId}` worktree without re-creating it
**Plans**: TBD
**UI hint**: yes

### Phase 18: Worktree Lifecycle
**Goal**: Worktrees are automatically cleaned up when tasks are closed out, and stale worktrees from previous sessions are pruned at app startup
**Depends on**: Phase 17
**Requirements**: LC-01, LC-02
**Success Criteria** (what must be TRUE):
  1. Moving a task to DONE or CANCELLED automatically removes its worktree directory and deletes the `task/{taskId}` branch
  2. If a task is cancelled before a worktree was created, the cleanup step is a no-op (no error thrown)
  3. When the Next.js server starts, `git worktree prune` runs for every GIT-type project that has a local path, clearing any orphaned worktree entries
**Plans**: TBD
**UI hint**: no

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Theme + General Settings | v0.1 | 2/2 | Complete | 2026-03-26 |
| 2. CLI Adapter Verification | v0.1 | 2/2 | Complete | 2026-03-26 |
| 3. Agent Prompt Management | v0.1 | 2/2 | Complete | 2026-03-27 |
| 4. Data Layer Foundation | v0.2 | 2/2 | Complete | 2026-03-27 |
| 5. MCP Knowledge Tools | v0.2 | 2/2 | Complete | 2026-03-27 |
| 6. File Serving & Image Rendering | v0.2 | 1/1 | Complete | 2026-03-27 |
| 7. Notes & Assets Web UI | v0.2 | 2/2 | Complete | 2026-03-27 |
| 8. Asset Description Schema | v0.3 | 1/1 | Complete | 2026-03-30 |
| 9. Search Actions Expansion | v0.3 | 1/1 | Complete | 2026-03-30 |
| 10. Search UI Extension | v0.3 | 2/2 | Complete | 2026-03-30 |
| 11. SystemConfig Foundation | v0.4 | 2/2 | Complete | 2026-03-30 |
| 12. Git Path Mapping Rules | v0.4 | 2/2 | Complete | 2026-03-30 |
| 13. Configurable System Parameters | v0.4 | 2/2 | Complete | 2026-03-30 |
| 14. Search Quality & Realtime Config | v0.4 | 2/2 | Complete | 2026-03-30 |
| 15. Schema & Cleanup | v0.5 | 2/2 | Complete    | 2026-03-31 |
| 16. Worktree Execution Engine | v0.5 | 0/2 | Planned | - |
| 17. Review & Merge Workflow | v0.5 | 0/TBD | Not started | - |
| 18. Worktree Lifecycle | v0.5 | 0/TBD | Not started | - |
