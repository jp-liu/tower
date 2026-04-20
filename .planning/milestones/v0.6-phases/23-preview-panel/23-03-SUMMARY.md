---
phase: 23-preview-panel
plan: 03
subsystem: ui
tags: [monaco, preview, react, nextjs, iframe]

# Dependency graph
requires:
  - phase: 23-01
    provides: PreviewPanel component, preview process manager, server actions (startPreview/stopPreview/openInTerminal)
  - phase: 23-02
    provides: Project settings UI (projectType segmented control, previewCommand input, terminal setting)
provides:
  - CodeEditor onSave prop with ref-based stale closure fix
  - PreviewPanel wired into workbench Preview tab with refreshKey
  - Preview tab hidden for BACKEND projects (projectType check)
  - page.tsx serialization of projectType + previewCommand fields
  - End-to-end Ctrl+S → iframe auto-refresh flow (PV-06)
affects: [phase-24, task-workbench]

# Tech tracking
tech-stack:
  added: []
  patterns: [onSaveRef pattern for Monaco stale closure, previewRefreshKey parent-controlled state]

key-files:
  created: []
  modified:
    - src/components/task/code-editor.tsx
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx
    - src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx

key-decisions:
  - "onSaveRef pattern: useRef + useEffect sync mirrors existing activeTabRef pattern — avoids stale closure in Monaco addAction"
  - "projectType check (not .type) for Preview tab visibility — .type is GIT/NORMAL, .projectType is FRONTEND/BACKEND"
  - "previewRefreshKey is parent-controlled in task-page-client — PreviewPanel receives it as prop, uses key={refreshKey} to force iframe re-render"

patterns-established:
  - "onSaveRef stale closure fix: always use ref pattern for callbacks passed to Monaco addAction (set up once at mount)"
  - "previewRefreshKey: parent owns refresh counter, CodeEditor calls onSave, parent increments, PreviewPanel re-renders iframe"

requirements-completed: [PV-01, PV-02, PV-03, PV-04, PV-06]

# Metrics
duration: 8min
completed: 2026-04-01
---

# Phase 23 Plan 03: Preview Panel Wiring Summary

**CodeEditor onSave prop with ref-based stale closure fix wires into PreviewPanel iframe auto-refresh, completing the end-to-end Ctrl+S → preview reload flow (PV-06) and hiding Preview tab for BACKEND projects (PV-01)**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-01T04:00:00Z
- **Completed:** 2026-04-01T04:08:00Z
- **Tasks:** 2 (+ 1 checkpoint pending human verification)
- **Files modified:** 3

## Accomplishments

- Added `onSave?: () => void` to `CodeEditorProps` with `onSaveRef` ref pattern to avoid stale closure in Monaco's `addAction` (which is set up once at mount)
- Fixed Preview tab visibility to use `task.project?.projectType !== "BACKEND"` instead of the wrong `.type` field
- Replaced Preview tab placeholder with functional `<PreviewPanel>` receiving `taskId`, `worktreePath`, `previewCommand`, `refreshKey`, and `projectId` props
- Updated `page.tsx` serialization to pass `projectType` and `previewCommand` from Project to the client component
- `previewRefreshKey` state in task-page-client increments on each Ctrl+S save, forcing iframe re-render in PreviewPanel

## Task Commits

Each task was committed atomically:

1. **Task 1: Add onSave prop to CodeEditor with ref-based stale closure fix** - `57fc5d3` (feat)
2. **Task 2: Wire PreviewPanel into workbench + fix BACKEND type check + update page.tsx serialization** - `9a2df2b` (feat)

_Task 3 (checkpoint:human-verify) pending user approval._

## Files Created/Modified

- `src/components/task/code-editor.tsx` - Added `onSave` prop, `onSaveRef` with useEffect sync, called after successful file save
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` - PreviewPanel import and usage, previewRefreshKey state, fixed projectType check, onSave wiring to CodeEditor
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/page.tsx` - Added `projectType` and `previewCommand` to serialized task.project object

## Decisions Made

- `onSaveRef` pattern mirrors existing `activeTabRef` — consistent with established Monaco stale-closure pattern from Phase 21
- `projectType` field (FRONTEND/BACKEND enum) is distinct from `type` field (GIT/NORMAL) — the Preview tab condition was checking the wrong field
- `previewRefreshKey` is owned by the parent component; `PreviewPanel` receives it as a prop and uses `key={refreshKey}` internally to force iframe re-render on change

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in `src/actions/agent-config-actions.ts` (unrelated to this plan) were noted but not fixed per scope boundary rules.

## Known Stubs

None — PreviewPanel is fully wired with real data (taskId, worktreePath from latestExecution, previewCommand from project, refreshKey from parent state).

## Next Phase Readiness

- All 6 PV requirements implemented in code; awaiting human verification checkpoint (Task 3)
- Preview tab visible for FRONTEND projects, hidden for BACKEND — conditional rendering correct
- Ctrl+S in Monaco editor → previewRefreshKey increments → PreviewPanel iframe reloads
- TypeScript passes cleanly for all 3 modified files

---
*Phase: 23-preview-panel*
*Completed: 2026-04-01*
