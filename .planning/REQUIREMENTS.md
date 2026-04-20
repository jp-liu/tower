# Requirements: v0.96 UX Polish & Knowledge Capture

## UI Fixes

- [ ] **UI-01**: Delete task button must not trigger task detail drawer/panel opening
- [ ] **UI-02**: Shared `<EmptyState />` component extracted and used across asset-list, assistant-chat, and other empty states
- [ ] **UI-03**: All icon buttons follow unified hover pattern (`hover:bg-accent hover:text-foreground transition-colors`) — audit and fix chat input area, thumbnail strip, etc.

## Asset Preview

- [x] **ASSET-01**: Clicking image asset opens fullscreen lightbox with zoom/pan and Escape to close
- [x] **ASSET-02**: Clicking text/md/json asset opens preview dialog with markdown rendering or monospace display
- [x] **ASSET-03**: "在文件夹中显示" button opens containing folder in system file manager (`open -R` on macOS)
- [x] **ASSET-04**: Asset action buttons reorganized to: [预览] [在文件夹中显示] [删除]

## Project Import & Migration

- [x] **PROJ-01**: "新建项目" flow accepts git URL, auto-resolves local path, clones if not exist
- [x] **PROJ-02**: "导入项目" flow with folder browser, auto-detect git remote, auto-fill project name
- [x] **PROJ-03**: Migration toggle on import — shows target path derived from git rules, editable
- [x] **PROJ-04**: Migration pre-checks block if RUNNING executions, active PTY sessions, or existing worktrees; warn "建议先关闭 IDE" (non-blocking)
- [x] **PROJ-05**: Migration executes `fs.rename` (atomic, same-filesystem) with mkdir -p for parent dir
- [x] **PROJ-06**: Migration error handling — rename failure leaves source intact, clear error messages

## Session Dreaming

- [x] **DREAM-01**: Phase 2+ AI analysis on final session stop (not on continue/resume) — structured JSON output (summary, insights, shouldCreateNote); git log uses full `merge-base..HEAD`
- [x] **DREAM-02**: Auto-create `ProjectNote` (category: `session-insight`) when AI determines significance
- [x] **DREAM-03**: Execution timeline shows "归纳" row linking to insight note (inline expand + navigate)
- [x] **DREAM-04**: `daily_summary` report includes `insights` section listing session-insight notes created that day

## Auto-Upload Hook

- [ ] **HOOK-01**: Global PostToolUse hook script gated by `TOWER_TASK_ID` env var (no-op when absent)
- [ ] **HOOK-02**: Hook detects file creation/reference matching configured types and uploads to Tower API; checks file exists before upload; respects `system.maxUploadBytes` size limit
- [ ] **HOOK-03**: File type whitelist configurable via SystemConfig `hooks.autoUploadTypes`
- [ ] **HOOK-04**: Internal upload API endpoint accepts taskId + filePath, copies to `data/assets/{projectId}/`
- [ ] **HOOK-05**: Environment variable rename: `AI_MANAGER_TASK_ID` → `TOWER_TASK_ID`, add `TOWER_API_URL`; signal dir rename `/tmp/ai-manager-signals/` → `/tmp/tower-signals/`
- [ ] **HOOK-06**: Settings page "安装 Hook" button — appends hook entry to existing `~/.claude/settings.json` hooks array (never overwrite existing hooks)

## Resource Attribution & Task Drawer

- [ ] **RES-01**: Project assets page shows all assets including task-bound ones (remove `taskId: null` filter)
- [ ] **RES-02**: Task-bound assets display `[任务: xxx]` label with task title
- [ ] **RES-03**: `TaskOverviewDrawer` component — shows task title, status, priority, description, labels, last execution summary, resource count, created date
- [ ] **RES-04**: Clicking task label in asset list opens TaskOverviewDrawer
- [ ] **RES-05**: Archive/completed task list items open TaskOverviewDrawer on click

---

## Future Requirements (deferred)

- 非图片文件粘贴支持
- 拖拽上传
- 缓存自动清理策略
- 任务抽屉内跳转到终端/详情操作
- 多用户/账号体系下的缓存隔离

## Out of Scope

- Keyboard shortcut system expansion — only 2 shortcuts, already Windows-compatible
- Electron/desktop features — pure web, local deploy only
- Cross-device migration (cp fallback) — local tool, same filesystem guaranteed

---

## Traceability

| Requirement | Phase | Plan | Status |
|-------------|-------|------|--------|
| UI-01 | Phase 55 | — | Pending |
| UI-02 | Phase 55 | — | Pending |
| UI-03 | Phase 55 | — | Pending |
| ASSET-01 | Phase 56 | — | Pending |
| ASSET-02 | Phase 56 | — | Pending |
| ASSET-03 | Phase 56 | — | Pending |
| ASSET-04 | Phase 56 | — | Pending |
| PROJ-01 | Phase 57 | — | Pending |
| PROJ-02 | Phase 57 | — | Pending |
| PROJ-03 | Phase 57 | — | Pending |
| PROJ-04 | Phase 57 | — | Pending |
| PROJ-05 | Phase 57 | — | Pending |
| PROJ-06 | Phase 57 | — | Pending |
| DREAM-01 | Phase 58 | — | Pending |
| DREAM-02 | Phase 58 | — | Pending |
| DREAM-03 | Phase 58 | — | Pending |
| DREAM-04 | Phase 58 | — | Pending |
| HOOK-01 | Phase 59 | — | Pending |
| HOOK-02 | Phase 59 | — | Pending |
| HOOK-03 | Phase 59 | — | Pending |
| HOOK-04 | Phase 59 | — | Pending |
| HOOK-05 | Phase 59 | — | Pending |
| HOOK-06 | Phase 59 | — | Pending |
| RES-01 | Phase 60 | — | Pending |
| RES-02 | Phase 60 | — | Pending |
| RES-03 | Phase 60 | — | Pending |
| RES-04 | Phase 60 | — | Pending |
| RES-05 | Phase 60 | — | Pending |

---

*Full design details: `.planning/v0.96-REQUIREMENTS.md`*
