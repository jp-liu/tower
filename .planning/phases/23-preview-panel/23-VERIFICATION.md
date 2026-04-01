---
phase: 23-preview-panel
verified: 2026-03-31T12:20:00Z
status: human_needed
score: 12/12 must-haves verified
human_verification:
  - test: "PV-01 — BACKEND type hides Preview tab: create a project with Backend type in the + dialog, navigate to its workbench task page, confirm Preview tab is NOT shown"
    expected: "Preview tab (with Eye icon) does not appear in the tab strip for BACKEND projects"
    why_human: "Conditional rendering based on runtime projectType value from DB; cannot assert tab DOM presence programmatically without running the app"
  - test: "PV-02 — Address bar loads URL in iframe: open a FRONTEND project workbench, click Preview tab, type http://localhost:3000 in address bar, press Enter"
    expected: "iframe src attribute updates to http://localhost:3000 and attempts to load it"
    why_human: "iframe navigation behavior requires browser environment"
  - test: "PV-03 — Run/Stop preview server: enter a command (e.g. echo hello) in command input, click Run, verify status badge changes to Running; click Stop, verify badge returns to Stopped"
    expected: "Status badge transitions: Stopped -> Starting -> Running; then Running -> Stopped on Stop click"
    why_human: "Process lifecycle and UI state machine require browser + OS interaction"
  - test: "PV-04 — Open in Terminal button: click Terminal icon button in preview toolbar"
    expected: "Terminal.app opens with the worktree directory (macOS only)"
    why_human: "Requires macOS open -a command execution and visual confirmation of terminal opening"
  - test: "PV-05 — Terminal setting persists: go to Settings > General, change Default Terminal value from 'Terminal' to 'iTerm2', navigate away and back"
    expected: "Input shows 'iTerm2' after reload; subsequent openInTerminal calls use iTerm2"
    why_human: "Config persistence requires DB round-trip and page reload"
  - test: "PV-06 — Auto-refresh on save: open a file in Files tab, edit content, press Ctrl+S; navigate to Preview tab"
    expected: "previewRefreshKey increments on save; iframe key changes force re-render; verify no stale closure by saving multiple times in sequence"
    why_human: "Monaco editor Ctrl+S handler and iframe reload require live browser session"
  - test: "Manual Refresh button: click the Refresh icon button in preview toolbar with a URL loaded in the iframe"
    expected: "iframe reloads (WARNING: current implementation uses setIframeUrl(url => url) which is a no-op — iframe will NOT reload)"
    why_human: "This is a known stub behavior documented in 23-02-SUMMARY.md — human verification to confirm it does not block PV-02 acceptance"
---

# Phase 23: Preview Panel Verification Report

**Phase Goal:** Users can run and preview their frontend project directly inside the workbench
**Verified:** 2026-03-31T12:20:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Project model has projectType (FRONTEND/BACKEND) and previewCommand fields in DB | VERIFIED | `prisma/schema.prisma` lines 30-31: `projectType ProjectCategory @default(FRONTEND)`, `previewCommand String?`; `ProjectCategory` enum at line 240 |
| 2 | createProject and updateProject accept projectType and previewCommand | VERIFIED | `src/actions/workspace-actions.ts` lines 78-90: both params accepted and passed to Prisma |
| 3 | Preview process registry tracks running processes by taskId and can kill them | VERIFIED | `src/lib/adapters/preview-process-manager.ts`: module-level `Map<string, ChildProcess>`, exports `registerPreviewProcess`, `killPreviewProcess`, `isPreviewRunning` |
| 4 | startPreview spawns dev server with shell:false and registers it | VERIFIED | `src/actions/preview-actions.ts` lines 22-31: `spawn(cmd, args, { shell: false })`, `registerPreviewProcess(taskId, child)` |
| 5 | stopPreview calls killPreviewProcess | VERIFIED | `src/actions/preview-actions.ts` line 39 |
| 6 | openInTerminal uses execFileSync with args array | VERIFIED | `src/actions/preview-actions.ts` line 46: `execFileSync("open", ["-a", terminalApp, worktreePath])` |
| 7 | terminal.app config default registered in CONFIG_DEFAULTS | VERIFIED | `src/lib/config-defaults.ts` line 48 confirmed |
| 8 | All new UI strings have zh and en translations | VERIFIED | `src/lib/i18n.tsx`: 14 preview.* keys, 3 project.type.* keys, 3 settings.terminal.* keys confirmed in both zh (lines 392-413) and en (lines 781-800) |
| 9 | PreviewPanel renders toolbar with Run/Stop button and status badge | VERIFIED | `src/components/task/preview-panel.tsx` lines 136-194: toolbar row with status badge and conditional Run/Stop button |
| 10 | PreviewPanel renders address bar — Enter key sets iframe URL | VERIFIED | Lines 216-226: address bar input with `handleAddressKeyDown` setting `iframeUrl` on Enter |
| 11 | PreviewPanel renders iframe with key={refreshKey} | VERIFIED | Lines 229-237: `<iframe key={refreshKey} .../>` |
| 12 | task-page-client.tsx replaces Preview tab placeholder with PreviewPanel | VERIFIED | Lines 397-406: `<PreviewPanel taskId={task.id} worktreePath={...} previewCommand={...} refreshKey={previewRefreshKey} projectId={...} />` |
| 13 | Preview tab hidden for BACKEND projects | VERIFIED | `task-page-client.tsx` line 324: `{task.project?.projectType !== "BACKEND" && (<TabsTrigger ...>)}` |
| 14 | CodeEditor onSave prop with ref-based stale closure fix | VERIFIED | `src/components/task/code-editor.tsx` lines 44, 68-78, 200: `onSave?` prop, `onSaveRef` pattern, called after successful save |
| 15 | previewRefreshKey increments when CodeEditor calls onSave | VERIFIED | `task-page-client.tsx` line 357: `onSave={() => setPreviewRefreshKey((k) => k + 1)}` |
| 16 | Settings General page has terminal app input | VERIFIED | `src/components/settings/general-config.tsx` lines 13-22, 94-102: state, useEffect load, onBlur save, terminal input UI |

**Score:** 12/12 truths verified (16 sub-truths, all verified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | ProjectCategory enum + projectType + previewCommand on Project | VERIFIED | Enum at line 240, fields at lines 30-31 |
| `src/lib/adapters/preview-process-manager.ts` | Module-level ChildProcess registry | VERIFIED | 22 lines, 3 exports, module-level Map singleton |
| `src/actions/preview-actions.ts` | startPreview, stopPreview, openInTerminal server actions | VERIFIED | 47 lines, "use server", all 3 exports |
| `src/lib/config-defaults.ts` | terminal.app default entry | VERIFIED | Line 48 confirmed |
| `src/components/task/preview-panel.tsx` | PreviewPanel client component | VERIFIED | 241 lines, exports PreviewPanel + PreviewPanelProps |
| `src/components/layout/top-bar.tsx` | Project type segmented control | VERIFIED | projectType state at line 46, FRONTEND/BACKEND control present |
| `src/components/settings/general-config.tsx` | Terminal app settings input | VERIFIED | getConfigValue/setConfigValue wired to terminal.app |
| `src/components/task/code-editor.tsx` | onSave callback prop | VERIFIED | onSave? added to CodeEditorProps, onSaveRef stale-closure fix |
| `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` | PreviewPanel wired with refreshKey | VERIFIED | PreviewPanel imported and used with all 5 required props |
| `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx` | projectType + previewCommand in serialized task | VERIFIED | Lines 28-29: both fields in serializeTask() |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/actions/preview-actions.ts` | `src/lib/adapters/preview-process-manager.ts` | registerPreviewProcess / killPreviewProcess imports | WIRED | Lines 5-9: all 3 functions imported and used |
| `src/actions/preview-actions.ts` | `src/lib/config-reader.ts` | readConfigValue("terminal.app", "Terminal") | WIRED | Line 10 import, line 45 call |
| `src/components/task/preview-panel.tsx` | `src/actions/preview-actions.ts` | startPreview / stopPreview / openInTerminal imports | WIRED | Line 7: all 3 imported; lines 85, 99, 112: all used in handlers |
| `src/components/settings/general-config.tsx` | `src/actions/config-actions.ts` | getConfigValue / setConfigValue for terminal.app | WIRED | Lines 18, 22 confirmed |
| `src/components/task/code-editor.tsx` | `task-page-client.tsx` | onSave prop — increment previewRefreshKey | WIRED | CodeEditorProps.onSave; task-page-client line 357 passes `() => setPreviewRefreshKey((k) => k + 1)` |
| `task-page-client.tsx` | `src/components/task/preview-panel.tsx` | PreviewPanel refreshKey={previewRefreshKey} | WIRED | Line 403: `refreshKey={previewRefreshKey}` |
| `task-page-client.tsx` | Preview tab visibility | task.project?.projectType !== "BACKEND" | WIRED | Line 324 confirmed |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `preview-panel.tsx` | previewCommand / taskId / worktreePath | Passed as props from task-page-client; originates from Prisma `db.task.findUnique({ include: { project: true } })` in page.tsx | Yes — full Prisma include, no hardcoded values | FLOWING |
| `preview-panel.tsx` | iframeUrl | User types in address bar; set on Enter keydown | Yes — user input driven | FLOWING |
| `preview-panel.tsx` | serverStatus | Returned from startPreview/stopPreview server actions | Yes — real spawn/kill process | FLOWING |
| `general-config.tsx` | terminalApp | `getConfigValue("terminal.app", "Terminal")` from DB via SystemConfig | Yes — DB-backed config read | FLOWING |
| `top-bar.tsx` | projectType | Local UI state (FRONTEND default), passed to createProject | Yes — passed to workspace-actions.ts which writes to DB | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| preview-process-manager module exports 3 functions | `node -e "const m=require('./src/lib/adapters/preview-process-manager'); console.log(typeof m.registerPreviewProcess, typeof m.killPreviewProcess, typeof m.isPreviewRunning)"` | SKIP — TS module, not CJS | SKIP |
| Unit tests pass (21 tests) | `pnpm test:run tests/unit/lib/preview-process-manager.test.ts tests/unit/actions/preview-actions.test.ts` | 21 passed, 0 failed, 202ms | PASS |
| TypeScript check — phase 23 files | `pnpm tsc --noEmit 2>&1 \| grep -E "preview\|code-editor\|task-page\|general-config\|top-bar"` | No errors for phase 23 files | PASS |
| TypeScript check — global | `pnpm tsc --noEmit` | 1 pre-existing error in `agent-config-actions.ts` (unrelated to phase 23) | PASS |
| shell:false enforced in startPreview | grep `shell: false` in preview-actions.ts | `shell: false` at line 26 | PASS |
| execFileSync args array in openInTerminal | grep `execFileSync` in preview-actions.ts | `execFileSync("open", ["-a", terminalApp, worktreePath])` at line 46 | PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PV-01 | 23-01, 23-02, 23-03 | 项目支持"前端/后端"类型区分，创建时默认前端，可选后端 | SATISFIED | ProjectCategory enum in schema, default FRONTEND, segmented control in create dialog, Preview tab hidden for BACKEND |
| PV-02 | 23-02, 23-03 | 前端项目工作台有预览面板，包含地址栏输入本地 URL + iframe 嵌入显示 | SATISFIED | PreviewPanel in Preview tab with address bar input and iframe |
| PV-03 | 23-01, 23-02 | 用户可配置项目预览启动命令，点击"运行"按钮启动 dev server | SATISFIED | previewCommand field, command input in PreviewPanel, Run button calls startPreview |
| PV-04 | 23-01, 23-02 | 预览面板提供"在终端打开"按钮，在本地终端 app 中打开 worktree 目录 | SATISFIED | Terminal icon button calls openInTerminal(worktreePath) |
| PV-05 | 23-01, 23-02 | 用户可在设置中配置默认终端应用 | SATISFIED | Settings > General has terminal app input backed by SystemConfig |
| PV-06 | 23-03 | 编辑器保存文件后自动刷新预览 iframe | SATISFIED | CodeEditor onSave prop → previewRefreshKey increment → iframe key={refreshKey} forces re-render |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/task/preview-panel.tsx` | 174-177 | Refresh button onClick uses `setIframeUrl((url) => url)` — same-value state update, React will not re-render iframe | Warning | Manual Refresh button is non-functional; does not block any PV requirement since PV-06 uses `key={refreshKey}` from parent state |

**Note:** The manual Refresh button stub was documented in `23-02-SUMMARY.md` as a known issue: "handleRefresh in toolbar Refresh button is a stub — refresh logic currently re-sets iframeUrl to itself." This is a warning-level finding only — no PV requirement specifies manual refresh behavior as a tracked deliverable.

### Human Verification Required

#### 1. PV-01 — BACKEND project hides Preview tab

**Test:** Create a new project via the + button in TopBar. Confirm the "Project Type" segmented control appears. Select "Backend". Save the project. Navigate to any task inside this project. Check the tab strip.
**Expected:** The Preview tab (with Eye icon) is absent from the tab strip for BACKEND projects.
**Why human:** Conditional rendering from runtime `projectType` DB value; requires browser and test data.

#### 2. PV-02 — Address bar loads URL in iframe

**Test:** Open a FRONTEND project workbench, click the Preview tab, type `http://localhost:3000` in the address bar input, press Enter.
**Expected:** The iframe's src updates to `http://localhost:3000` and attempts to load the page.
**Why human:** iframe navigation requires browser environment.

#### 3. PV-03 — Run/Stop dev server lifecycle

**Test:** In the preview toolbar command input, enter a short-lived command (e.g., `echo hello`). Click the "Run" button. Observe status badge transitions. Click "Stop".
**Expected:** Badge transitions Stopped → Starting → Running; then Running → Stopped. No error state appears for a valid command.
**Why human:** Process spawn + OS interaction + UI state machine require live runtime.

#### 4. PV-04 — Open in Terminal button

**Test:** On macOS, click the Terminal icon button in the preview toolbar (requires a task with an active worktree / worktreePath).
**Expected:** Terminal.app (or configured app) opens at the worktree directory.
**Why human:** macOS `open -a` command requires live OS interaction.

#### 5. PV-05 — Terminal app setting persists

**Test:** Navigate to Settings > General. Find "Default Terminal" / "默认终端" input. Change value to `iTerm2`. Click away (onBlur). Navigate away from Settings and back.
**Expected:** Input shows `iTerm2` after page reload — value persisted to SystemConfig DB.
**Why human:** DB persistence and page reload required.

#### 6. PV-06 — Auto-refresh on Ctrl+S

**Test:** Open a file in the Files tab. Make any edit. Press Ctrl+S. Navigate to the Preview tab (or have both visible). Save multiple times in sequence.
**Expected:** Each Ctrl+S increments `previewRefreshKey`, causing the iframe to re-render (force reload if URL is set). No stale closure — every save triggers refresh.
**Why human:** Monaco editor Ctrl+S handler + iframe behavior require live browser session.

#### 7. Manual Refresh button (warning, not blocking)

**Test:** With a URL loaded in the iframe, click the Refresh icon button in the toolbar.
**Expected (actual behavior):** The iframe does NOT reload — `setIframeUrl((url) => url)` is a no-op in React since the value doesn't change.
**Why human:** Confirm this stub behavior is acceptable for the current phase. If manual refresh is expected to work, this needs a fix (e.g., local refresh counter, or expose a `onRefresh` prop from parent).

### Gaps Summary

No automated gaps found. All 12 must-haves are verified at all 4 levels (exists, substantive, wired, data-flowing). The pre-existing TypeScript error in `agent-config-actions.ts` is unrelated to phase 23 and was present before this phase started (confirmed in 23-02-SUMMARY.md and 23-03-SUMMARY.md).

The only finding is a warning-level stub: the manual Refresh button uses a no-op state update instead of a real refresh mechanism. This does not block any tracked PV requirement.

All 6 PV requirements have implementation evidence. Human verification of runtime behavior (PV-01 through PV-06) is the only remaining gate.

---

_Verified: 2026-03-31T12:20:00Z_
_Verifier: Claude (gsd-verifier)_
