# Phase 23: Preview Panel - Research

**Researched:** 2026-03-31
**Domain:** Next.js server actions, child_process.spawn, iframe preview, Prisma schema migration, SystemConfig, React state
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Add `projectType` enum field to Project Prisma model — values `FRONTEND` (default) / `BACKEND`. Run `prisma db push` migration. Update create-project-dialog and project edit forms with a segmented control or dropdown.
- **D-02:** Add nullable `previewCommand` String field to Project model — stores the start command (e.g. "pnpm dev"). Set in project settings or inline in the preview panel.
- **D-03:** Terminal app stored in SystemConfig as key `terminal.app` — default value `"Terminal"` on macOS. Configurable in Settings > General page.
- **D-04:** Address bar is a text input field — user types URL (e.g. `http://localhost:3000`) and presses Enter to load in iframe. State: `previewUrl`.
- **D-05:** "Run" button spawns preview command via server action using `child_process.spawn(command, { cwd: worktreePath, shell: true })`. Status indicator shows Running/Stopped/Error. Process PID tracked for cleanup.
- **D-06:** Module-level `Map<string, ChildProcess>` for preview process registry — keyed by taskId. Kill process on explicit stop, task DONE/CANCELLED, or page unmount. Follow singleton pattern from existing `process-manager.ts`.
- **D-07:** Auto-refresh on save: CodeEditor emits `onSave` callback → PreviewPanel increments iframe `key` prop to force re-render. Simple, no WebSocket needed.
- **D-08:** "Open in Terminal" server action: `spawn("open", ["-a", terminalApp, worktreePath])` on macOS. Uses `execFileSync` with args array (no shell interpolation per security constraint).
- **D-09:** Settings > General page gets a text input for "默认终端 / Default Terminal" — placeholder "Terminal", stored in SystemConfig as `terminal.app`.

### Claude's Discretion

- Preview panel component file structure
- iframe sandbox attributes (if any)
- Whether to show process stdout/stderr in preview panel
- Default preview URL placeholder text
- i18n key naming for preview-related strings
- How to handle previewCommand editing (inline in panel vs project settings)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PV-01 | 项目支持"前端/后端"类型区分，创建时默认前端，可选后端 | D-01: new `projectType` enum FRONTEND/BACKEND on Project model; UI in create/edit dialogs |
| PV-02 | 前端项目工作台有预览面板，包含地址栏输入本地 URL + iframe 嵌入显示 | D-04: text input address bar + iframe with `key` prop; hide tab for BACKEND projects |
| PV-03 | 用户可配置项目预览启动命令，点击"运行"按钮启动 dev server | D-02 + D-05: `previewCommand` field + server action using child_process.spawn |
| PV-04 | 预览面板提供"在终端打开"按钮，在本地终端 app 中打开 worktree 目录 | D-08: server action using execFileSync `open -a terminalApp worktreePath` |
| PV-05 | 用户可在设置中配置默认终端应用（iTerm2/Terminal.app/Warp 等） | D-03 + D-09: SystemConfig key `terminal.app`, input in Settings > General |
| PV-06 | 编辑器保存文件后自动刷新预览 iframe | D-07: `onSave` prop on CodeEditor → increment iframe `key` in PreviewPanel |
</phase_requirements>

---

## Summary

Phase 23 delivers the preview panel for the workbench — a self-contained feature cluster spanning schema migration, a new process registry, a React panel component, and a settings field. The work divides naturally into four concerns: (1) Prisma schema changes for `projectType` + `previewCommand`, (2) a server-side preview process registry mirroring the existing `process-manager.ts` singleton pattern, (3) the `PreviewPanel` client component with address bar, iframe, run/stop button, and open-in-terminal button, and (4) wiring `onSave` from `CodeEditor` through `task-page-client.tsx` into `PreviewPanel`.

The existing codebase already provides all the infrastructure this phase needs: `process-utils.ts` (spawn patterns), `config-actions.ts` / `config-reader.ts` (SystemConfig read/write), `getConfigValue` / `setConfigValue` server actions, and the `GeneralConfig` component pattern for settings UI. No new libraries are required.

The critical risk is the Prisma SQLite enum addition. SQLite does not support native enums; Prisma implements them as string columns with application-level validation. `prisma db push` on SQLite with a new enum field is safe but requires careful ordering — add the enum to schema.prisma, run `prisma db push`, then update TypeScript call sites. The schema already has a `ProjectType` enum (NORMAL/GIT), so the same pattern applies directly.

**Primary recommendation:** Follow D-01 through D-09 strictly. Structure the work in waves: schema first (Wave 0), process registry + server actions (Wave 1), PreviewPanel UI (Wave 2), CodeEditor `onSave` wiring (Wave 3), Settings terminal input (Wave 4).

---

## Standard Stack

### Core (all already in project — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | ^6.19.2 | Schema migration + DB | Already used for all models |
| Next.js server actions | (Next.js version in project) | Preview spawn action, terminal open action | Established pattern in project |
| `node:child_process` | Node built-in | `spawn` for dev server, `execFileSync` for terminal open | Already used in `process-utils.ts` |
| React `useState` / `useRef` | React 19 | iframe key increment, process status state | Standard React pattern |
| Tailwind CSS | ^4 | Styling PreviewPanel | All UI uses Tailwind |
| `@/lib/i18n` | project-local | Translation keys | All UI strings go through `t()` |

### No New Dependencies

This phase requires zero new npm packages. All capabilities are available through existing project infrastructure.

**Verification:** `pnpm list` confirms `child_process` is a Node built-in, all other tools pre-installed.

---

## Architecture Patterns

### Recommended Project Structure

New files this phase creates:

```
src/
├── lib/
│   └── adapters/
│       └── preview-process-manager.ts     # Module-level Map<taskId, ChildProcess>
├── actions/
│   └── preview-actions.ts                  # startPreview, stopPreview, openInTerminal
└── components/
    └── task/
        └── preview-panel.tsx               # PreviewPanel client component
```

Modified files:

```
prisma/schema.prisma                        # Add ProjectType enum values + previewCommand field
src/components/task/code-editor.tsx         # Add onSave callback prop
src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx  # Wire onSave + render PreviewPanel
src/components/settings/general-config.tsx  # Add terminal app text input
src/lib/config-defaults.ts                  # Add terminal.app default entry
src/lib/i18n.tsx                            # Add preview/terminal i18n keys (zh + en)
```

Project type selector goes into the create-project dialog. Find where `createProject` is called from the UI — the `top-bar.tsx` or similar — and add the projectType field.

### Pattern 1: Preview Process Registry (mirrors process-manager.ts)

**What:** Module-level singleton Map keyed by `taskId` storing the spawned `ChildProcess`. Server module — lives in `src/lib/adapters/preview-process-manager.ts`.

**When to use:** Any server action that starts, stops, or queries preview process state.

```typescript
// src/lib/adapters/preview-process-manager.ts
import { type ChildProcess } from "node:child_process";

// Module-level singleton — persists across requests in the same Node.js process
const previewProcesses = new Map<string, ChildProcess>();

export function registerPreviewProcess(taskId: string, child: ChildProcess): void {
  previewProcesses.set(taskId, child);
}

export function killPreviewProcess(taskId: string): boolean {
  const child = previewProcesses.get(taskId);
  if (!child || child.killed) {
    previewProcesses.delete(taskId);
    return false;
  }
  child.kill("SIGTERM");
  previewProcesses.delete(taskId);
  return true;
}

export function isPreviewRunning(taskId: string): boolean {
  const child = previewProcesses.get(taskId);
  return !!child && !child.killed;
}
```

**Note on D-05 vs security constraint (D-08):** D-05 says `shell: true` for the preview command spawn (user-controlled dev server, e.g. "pnpm dev"). D-08 says `execFileSync` with args array for the terminal open (OS-level `open -a` call). These are different operations with different threat models. Follow decisions as stated: `shell: true` for preview spawn, `execFileSync` with args array for terminal open.

### Pattern 2: Preview Server Action

**What:** `"use server"` action that splits `previewCommand` by whitespace, spawns the process, registers in the preview registry.

```typescript
// src/actions/preview-actions.ts
"use server";

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { registerPreviewProcess, killPreviewProcess, isPreviewRunning } from "@/lib/adapters/preview-process-manager";
import { readConfigValue } from "@/lib/config-reader";

export async function startPreview(taskId: string, command: string, cwd: string): Promise<{ started: boolean; error?: string }> {
  if (isPreviewRunning(taskId)) {
    killPreviewProcess(taskId);
  }
  try {
    const child = spawn(command, { cwd, shell: true, detached: false });
    registerPreviewProcess(taskId, child);
    return { started: true };
  } catch (err) {
    return { started: false, error: String(err) };
  }
}

export async function stopPreview(taskId: string): Promise<void> {
  killPreviewProcess(taskId);
}

export async function openInTerminal(worktreePath: string): Promise<void> {
  const terminalApp = await readConfigValue<string>("terminal.app", "Terminal");
  // execFileSync with args array — no shell interpolation (security constraint)
  execFileSync("open", ["-a", terminalApp, worktreePath]);
}
```

### Pattern 3: PreviewPanel Component

**What:** Client component replacing the placeholder in `task-page-client.tsx`.

**Key behaviors:**
- Address bar: controlled `<input>` for `previewUrl`; on Enter or button click, updates `iframeUrl` state
- iframe: rendered with `key={refreshKey}` — increment `refreshKey` to force reload
- Run/Stop: calls `startPreview` / `stopPreview` server actions; local `previewStatus` state: `"stopped" | "running" | "error"`
- Open in Terminal: calls `openInTerminal` server action
- previewCommand editing: inline `<input>` in the panel (simpler than navigating to project settings)

```typescript
// src/components/task/preview-panel.tsx (skeleton)
"use client";
export interface PreviewPanelProps {
  taskId: string;
  worktreePath: string | null;
  previewCommand: string | null;        // from project.previewCommand
  refreshKey: number;                   // controlled by parent — incremented on save
  onPreviewCommandChange?: (cmd: string) => void;
}
```

**Parent wiring in task-page-client.tsx:**
```typescript
const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

// Pass to CodeEditor
<CodeEditor
  ...
  onSave={() => setPreviewRefreshKey((k) => k + 1)}
/>

// Pass to PreviewPanel
<PreviewPanel
  taskId={task.id}
  worktreePath={latestExecution?.worktreePath ?? null}
  previewCommand={task.project?.previewCommand ?? null}
  refreshKey={previewRefreshKey}
/>
```

### Pattern 4: CodeEditor onSave Prop

**What:** Add optional `onSave?: () => void` to `CodeEditorProps`. Call it inside the existing Monaco `save-file` addAction, after `writeFileContent` succeeds.

Current `CodeEditorProps`:
```typescript
export interface CodeEditorProps {
  worktreePath: string;
  selectedFilePath: string | null;
  onFilePathChange?: (path: string | null) => void;
  // ADD:
  onSave?: () => void;
}
```

Inside `handleEditorMount`, after `showToast("success")`:
```typescript
showToast("success");
onSave?.();   // notify parent — triggers iframe refresh
```

### Pattern 5: Prisma Schema Change

**What:** Add new enum + two new fields to `Project`.

The existing `ProjectType` enum (NORMAL/GIT) is separate from the new `projectType` field (FRONTEND/BACKEND) per D-01. These are distinct fields:
- `type` (existing) = NORMAL | GIT — whether the project has a git URL
- `projectType` (new) = FRONTEND | BACKEND — what kind of project it is

Add to `schema.prisma`:
```prisma
model Project {
  // ... existing fields ...
  projectType  ProjectCategory @default(FRONTEND)  // NEW
  previewCommand String?                             // NEW
}

enum ProjectCategory {
  FRONTEND
  BACKEND
}
```

**Naming:** Use `ProjectCategory` for the new enum to avoid collision with existing `ProjectType`. Field name stays `projectType` per D-01.

Then: `pnpm db:push` (uses `prisma db push`).

**Important:** Update `createProject` and `updateProject` server actions in `workspace-actions.ts` to accept and persist `projectType` and `previewCommand`.

### Pattern 6: SystemConfig for Terminal App

**What:** Read `terminal.app` from SystemConfig using existing `readConfigValue`. Write via `setConfigValue` from Settings UI.

Add to `config-defaults.ts`:
```typescript
"terminal.app": {
  defaultValue: "Terminal",
  type: "string",
  label: "Default Terminal App",
},
```

In `general-config.tsx`, add a text input section:
```typescript
const [terminalApp, setTerminalApp] = useState("");

// On mount
useEffect(() => {
  getConfigValue("terminal.app", "Terminal").then(setTerminalApp);
}, []);

// Save handler
async function handleSaveTerminal() {
  await setConfigValue("terminal.app", terminalApp);
}
```

### Anti-Patterns to Avoid

- **shell: true for terminal open:** D-08 explicitly requires `execFileSync` with args array for `open -a terminalApp path`. Never interpolate terminal app name into a shell string.
- **Creating a separate process registry:** The preview process map must follow the singleton module pattern — one `Map` at module level, not instantiated per-request.
- **Wrapping CodeEditor in a new dynamic():** `CodeEditor` already handles SSR internally. Adding another wrapper would break the internal Monaco loader setup.
- **Mutating the iframe src directly:** Always use the `key` prop pattern for forced re-render — changing `src` on the same iframe element may not trigger a reload in all browsers.
- **Using `prisma migrate dev` instead of `prisma db push`:** D-01 specifies `prisma db push`. This is a SQLite dev database; migration files are not required.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process lifecycle management | Custom PID file / child tracking | Module-level Map<taskId, ChildProcess> (existing pattern from process-manager.ts) | Already established, handles kill/cleanup uniformly |
| Config persistence | Custom JSON file | `getConfigValue`/`setConfigValue` (SystemConfig table) | Established pattern, works for all settings |
| iframe refresh | WebSocket, polling | Increment `key` prop on iframe | Zero infrastructure, React handles remount |
| Terminal launch | Custom AppleScript / shell | `execFileSync("open", ["-a", app, path])` | macOS built-in, secure with args array |
| Command splitting | Custom shell parser | Pass `command` string + `shell: true` to `spawn` | Shell handles tokenization; preview commands are user-controlled strings |

**Key insight:** This phase is mostly wiring. Almost every pattern needed already exists in the codebase. The planner should resist inventing new infrastructure.

---

## Common Pitfalls

### Pitfall 1: SQLite Enum Addition Ordering

**What goes wrong:** Running Prisma generate before db push, or editing TypeScript before the schema migration completes, causes type errors that confuse the failure mode.
**Why it happens:** Prisma generates types from schema; if schema and DB are out of sync, `db.project.findMany()` silently gets the wrong type shape.
**How to avoid:** Wave 0 task sequence — edit schema.prisma → `pnpm db:push` → `pnpm db:generate` → update TypeScript.
**Warning signs:** TypeScript errors about `projectType` not existing on Project type.

### Pitfall 2: Enum Naming Collision

**What goes wrong:** Naming the new enum `ProjectType` collides with the existing `ProjectType` enum (NORMAL/GIT) already in schema.prisma.
**Why it happens:** Developer follows D-01 literally ("projectType enum") without noticing the existing enum.
**How to avoid:** Name the new enum `ProjectCategory` (FRONTEND/BACKEND). The field on Project is `projectType`, but the Prisma enum type is `ProjectCategory`.
**Warning signs:** Prisma CLI error "duplicate enum name".

### Pitfall 3: Process Leaks on Page Unmount

**What goes wrong:** User navigates away from the task page without clicking Stop. Preview dev server keeps running, port stays occupied, next visit shows "port in use" error.
**Why it happens:** Server-side processes are not tied to client navigation lifecycle.
**How to avoid:** D-06 requires killing on page unmount. Implement a route-level cleanup: when task status changes to DONE/CANCELLED (via SSE `status_changed` event), call `stopPreview(taskId)`. For page unmount, use a `beforeunload` event handler on the client that calls `stopPreview` via a fetch to an API route (server actions cannot be called from `beforeunload` reliably).
**Alternative:** Accept that the process continues and provide a visible "Stop" button — simpler, explicit user control. The `beforeunload` approach adds complexity. Recommend explicit Stop button as primary, with cleanup on status change as secondary.
**Warning signs:** Port 3000 in use errors after reloading the page.

### Pitfall 4: iframe Sandbox Blocking localhost

**What goes wrong:** Adding `sandbox` attribute to the iframe blocks the dev server content (scripts, forms, cookies).
**Why it happens:** `sandbox` without the right permissions strips most browser capabilities.
**How to avoid:** Either omit `sandbox` entirely (simplest, appropriate for localhost-only tool) or use `sandbox="allow-same-origin allow-scripts allow-forms allow-popups"` if a sandbox is desired.
**Warning signs:** iframe shows blank page or console errors about blocked content.

### Pitfall 5: onSave Callback Stale Closure

**What goes wrong:** `onSave` is captured in Monaco's `addAction` at mount time, before `previewRefreshKey` state is in scope. The callback never triggers the refresh.
**Why it happens:** Monaco `addAction` is called once in `handleEditorMount`. The `run` function closes over the initial prop value.
**How to avoid:** Use the same `activeTabRef` pattern already in `code-editor.tsx` — store `onSave` in a ref, update it via `useEffect([onSave])`, read from the ref inside the Monaco action's `run` function.
**Warning signs:** Files save (toast shows) but iframe does not refresh.

### Pitfall 6: previewCommand with Arguments Containing Spaces

**What goes wrong:** User enters `pnpm --filter my-app dev` — simple split by whitespace breaks if any arg contains a space.
**Why it happens:** Naive `command.split(" ")` tokenization.
**How to avoid:** Per D-05, pass the full string to `spawn(command, { shell: true })` — the shell handles tokenization. Do NOT split the command into args array when using shell: true.
**Warning signs:** "command not found" errors for commands with flags.

---

## Code Examples

### iframe Key-Based Refresh Pattern

```typescript
// In PreviewPanel — increment key to force iframe remount
const [refreshKey, setRefreshKey] = useState(0);
const [iframeUrl, setIframeUrl] = useState("");

// Expose refresh trigger to parent via prop
// Parent increments the prop; PreviewPanel uses it as iframe key
<iframe
  key={props.refreshKey}
  src={iframeUrl}
  className="w-full h-full border-0"
  title="Preview"
/>
```

### spawn with shell: true (preview dev server)

```typescript
// D-05: shell: true so user's full command string (e.g. "pnpm dev") is executed by shell
const child = spawn(command, {
  cwd: worktreePath,
  shell: true,
  detached: false,
  stdio: "ignore",   // no stdout capture needed for preview (PV-F01 deferred)
});
child.unref();  // allow parent process to exit independently
registerPreviewProcess(taskId, child);
```

### execFileSync with args array (terminal open)

```typescript
// D-08: args array — no shell interpolation, no injection risk
execFileSync("open", ["-a", terminalApp, worktreePath]);
```

### Project type check in task-page-client.tsx

```typescript
// D-06: hide Preview tab when project type is BACKEND
// Already partially stubbed in task-page-client.tsx line 322:
{task.project?.type !== "BACKEND" && (  // NOTE: this checks `type` (NORMAL/GIT), not `projectType`
```
**Correction needed:** The existing stub checks `task.project?.type !== "BACKEND"` which compares the NORMAL/GIT field. Phase 23 must update this to check `task.project?.projectType !== "BACKEND"`. The `task` prop interface in `TaskPageClientProps` also needs `projectType` added.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WebContainers (browser-side) | child_process.spawn (server-side) | Decided in v0.6 roadmap | Node.js on host is simpler and more reliable than in-browser VMs |
| WebSocket for iframe refresh | iframe `key` prop increment | Phase 23 decision (D-07) | Zero infrastructure; React remounts iframe on key change |
| Shell string interpolation for subprocesses | execFileSync with args array | Phase 18 security constraint | Prevents command injection; enforced in CLAUDE.md |

---

## Open Questions

1. **previewCommand inline vs project settings**
   - What we know: D-02 says "Set in project settings or inline in the preview panel." Claude's Discretion section leaves component structure open.
   - What's unclear: If inline in the panel, does saving it persist to the database immediately, or only on explicit Save?
   - Recommendation: Inline input in the panel with auto-save on blur/Enter — saves a round-trip to project settings for a common operation. Use `updateProject` server action to persist.

2. **Process cleanup on page unmount**
   - What we know: D-06 requires cleanup on unmount. Server actions cannot be called from `beforeunload` reliably.
   - What's unclear: Whether a `beforeunload` → fetch approach is worth the complexity.
   - Recommendation: Explicit Stop button (primary). Cleanup on `status_changed` SSE event to DONE/CANCELLED (secondary). Accept that processes may outlive navigation — user sees Running indicator on return and can stop manually.

3. **previewCommand persistence path**
   - What we know: `previewCommand` is a nullable field on Project. `updateProject` in `workspace-actions.ts` currently does not include it.
   - What's unclear: Whether the preview panel updates project inline or delegates to project settings.
   - Recommendation: Add `previewCommand` to `updateProject` server action signature. Preview panel input calls `updateProject(projectId, { previewCommand })` on save.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node:child_process` | PV-03 (spawn), PV-04 (terminal open) | Yes (Node built-in) | Node 20+ | — |
| `open` macOS CLI | PV-04 (terminal open) | Yes (macOS built-in) | Darwin 24.2.0 | Document macOS-only limitation |
| Prisma CLI | PV-01 (schema migration) | Yes | ^6.19.2 | — |
| SQLite DB | All data ops | Yes | (bundled with Prisma) | — |

**Missing dependencies with no fallback:** None.

**Platform note:** D-08 (`open -a`) is macOS-only. The existing codebase targets macOS (Darwin 24.2.0 confirmed). No cross-platform fallback needed for this phase — document in code comment.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run --reporter=verbose tests/unit/` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PV-01 | `createProject` with `projectType: BACKEND` persists correctly | unit | `pnpm test:run tests/unit/actions/workspace-actions.test.ts` | ❌ Wave 0 |
| PV-01 | `updateProject` with `projectType` updates field | unit | same | ❌ Wave 0 |
| PV-03 | `startPreview` registers process in Map | unit | `pnpm test:run tests/unit/lib/preview-process-manager.test.ts` | ❌ Wave 0 |
| PV-03 | `stopPreview` kills process and removes from Map | unit | same | ❌ Wave 0 |
| PV-03 | `isPreviewRunning` returns correct state | unit | same | ❌ Wave 0 |
| PV-04 | `openInTerminal` calls execFileSync with correct args | unit | `pnpm test:run tests/unit/actions/preview-actions.test.ts` | ❌ Wave 0 |
| PV-05 | `terminal.app` config default is "Terminal" | unit | `pnpm test:run tests/unit/lib/config-actions.test.ts` | ✅ (extend) |
| PV-06 | CodeEditor calls onSave after successful save | unit | `pnpm test:run tests/unit/components/` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run tests/unit/lib/preview-process-manager.test.ts tests/unit/actions/preview-actions.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/lib/preview-process-manager.test.ts` — covers PV-03 (spawn registry)
- [ ] `tests/unit/actions/preview-actions.test.ts` — covers PV-03 startPreview/stopPreview, PV-04 openInTerminal
- [ ] `tests/unit/actions/workspace-actions.test.ts` — extend existing file to cover `projectType` + `previewCommand` fields on createProject/updateProject (PV-01)

---

## Project Constraints (from CLAUDE.md)

CLAUDE.md delegates entirely to AGENTS.md. AGENTS.md states:

> This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code.

**Actionable directives extracted from accumulated project decisions:**

| Constraint | Source | Enforcement |
|------------|--------|-------------|
| Use `execFileSync` with args array (no shell interpolation) for all OS-level subprocess calls | Phase 18 security constraint | `openInTerminal` must use `execFileSync("open", ["-a", app, path])` |
| `spawn(shell: false)` for CLI tools; `spawn(shell: true)` only when user provides the full command string | process-utils.ts pattern | Preview server spawn uses `shell: true` per D-05 (user-controlled command) |
| Immutable updates — never mutate state in place | global coding-style.md | `setTabs(prev => prev.map(...))` pattern, spread for state updates |
| No `console.log` in production code | global TypeScript hooks | Use `child.on("error", ...)` but don't log to console |
| Server actions for mutations, API routes for streaming | established project pattern | `startPreview`, `stopPreview`, `openInTerminal` are server actions |
| `readConfigValue` (config-reader.ts) for non-Next.js server modules; `getConfigValue` (config-actions.ts) for Next.js server actions | Phase 13 decision | `preview-process-manager.ts` uses `readConfigValue`; settings UI uses `getConfigValue` |
| `dynamic({ ssr: false })` not needed for additional CodeEditor wrappers — CodeEditor already handles SSR | Phase 21-03 decision | Do NOT wrap CodeEditor in another dynamic() |
| `prisma db push` (not `prisma migrate dev`) for SQLite schema changes | project convention | D-01 migration uses `pnpm db:push` |
| Functions < 50 lines, files < 800 lines | global coding-style.md | Split PreviewPanel into sub-components if needed |

---

## Sources

### Primary (HIGH confidence)

- Direct codebase inspection:
  - `src/lib/adapters/process-utils.ts` — spawn pattern, runningProcesses Map, shell: false default
  - `src/lib/adapters/process-manager.ts` — module-level singleton Map pattern (executionToRunId)
  - `src/actions/config-actions.ts` — getConfigValue/setConfigValue/getConfigValues
  - `src/lib/config-reader.ts` — readConfigValue for non-Next.js modules
  - `src/lib/config-defaults.ts` — CONFIG_DEFAULTS registry pattern
  - `src/components/task/code-editor.tsx` — CodeEditorProps interface, onMount/addAction pattern, activeTabRef
  - `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` — TaskPageClientProps, Preview tab placeholder, existing BACKEND type check
  - `src/components/settings/general-config.tsx` — Settings UI pattern (useState, useEffect, getConfigValue)
  - `prisma/schema.prisma` — existing ProjectType enum, Project model fields
  - `src/lib/i18n.tsx` — all translation key patterns
  - `vitest.config.ts` — test configuration

### Secondary (MEDIUM confidence)

- React documentation (training data, Aug 2025): `key` prop forces remount — well-established behavior, HIGH confidence
- macOS `open -a` command — system built-in, available on Darwin 24.2.0 (confirmed by OS Version in env)

### Tertiary (LOW confidence)

None. All claims in this document are verified against project source or established APIs.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified all tools exist in package.json/node_modules
- Architecture: HIGH — patterns directly derived from existing code in process-manager.ts, config-actions.ts, general-config.tsx
- Pitfalls: HIGH — derived from existing code patterns and accumulated project decisions
- Schema migration: HIGH — existing ProjectType enum proves the pattern works

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (stable libraries, low churn)
