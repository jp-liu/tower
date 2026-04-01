# Phase 23: Preview Panel - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the preview panel for the workbench. Six capabilities: (1) project type field (Frontend/Backend) with UI in create/edit project dialogs, (2) preview panel with address bar + iframe for frontend projects, (3) configurable preview start command with "Run" button to launch dev server, (4) "Open in Terminal" button to open worktree in local terminal app, (5) terminal app config in Settings, (6) auto-refresh iframe on editor save.

</domain>

<decisions>
## Implementation Decisions

### Schema & Project Type
- **D-01:** Add `projectType` enum field to Project Prisma model — values `FRONTEND` (default) / `BACKEND`. Run `prisma db push` migration. Update create-project-dialog and project edit forms with a segmented control or dropdown.
- **D-02:** Add nullable `previewCommand` String field to Project model — stores the start command (e.g. "pnpm dev"). Set in project settings or inline in the preview panel.
- **D-03:** Terminal app stored in SystemConfig as key `terminal.app` — default value `"Terminal"` on macOS. Configurable in Settings > General page.

### Preview Panel UX
- **D-04:** Address bar is a text input field — user types URL (e.g. `http://localhost:3000`) and presses Enter to load in iframe. State: `previewUrl`.
- **D-05:** "Run" button spawns preview command via server action using `child_process.spawn(command, { cwd: worktreePath, shell: true })`. Status indicator shows Running/Stopped/Error. Process PID tracked for cleanup.
- **D-06:** Module-level `Map<string, ChildProcess>` for preview process registry — keyed by taskId. Kill process on explicit stop, task DONE/CANCELLED, or page unmount. Follow singleton pattern from existing `process-manager.ts`.
- **D-07:** Auto-refresh on save: CodeEditor emits `onSave` callback → PreviewPanel increments iframe `key` prop to force re-render. Simple, no WebSocket needed.

### Terminal Integration
- **D-08:** "Open in Terminal" server action: `spawn("open", ["-a", terminalApp, worktreePath])` on macOS. Uses `execFileSync` with args array (no shell interpolation per security constraint).
- **D-09:** Settings > General page gets a text input for "默认终端 / Default Terminal" — placeholder "Terminal", stored in SystemConfig as `terminal.app`.

### Claude's Discretion
- Preview panel component file structure
- iframe sandbox attributes (if any)
- Whether to show process stdout/stderr in preview panel
- Default preview URL placeholder text
- i18n key naming for preview-related strings
- How to handle previewCommand editing (inline in panel vs project settings)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/adapters/process-manager.ts` — existing process lifecycle management pattern (spawn, kill, PID tracking)
- `src/lib/adapters/process-utils.ts` — `spawn(shell: false)` approach reference
- `src/actions/workspace-actions.ts` — createProject/updateProject server actions
- `src/components/board/create-task-dialog.tsx` — existing dialog pattern for project creation
- `SystemConfig` + `getConfigValue/setConfigValue` — settings storage pattern
- `task-page-client.tsx` — workbench with Preview tab placeholder to replace

### Established Patterns
- `execFileSync` with args array for all subprocess calls (security constraint)
- Server actions for mutations, API routes for streaming
- SystemConfig for user preferences
- Tailwind CSS for styling

### Integration Points
- `prisma/schema.prisma` — add projectType enum + previewCommand field to Project
- `task-page-client.tsx` — replace Preview tab placeholder with PreviewPanel component
- `code-editor.tsx` — add `onSave` callback prop for auto-refresh
- Settings General page — add terminal app input
- `create-project-dialog.tsx` — add project type selector

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 23-preview-panel*
*Context gathered: 2026-04-01*
