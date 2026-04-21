# Phase 63: Mission Terminal Open - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Add an "在终端打开" button to Mission Control cards that opens the system terminal at the project's localPath. Only visible when the task's project has a non-empty localPath.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — infrastructure phase. The `openInTerminal` server action already exists in `src/actions/preview-actions.ts` (from v0.6 Phase 23). This phase only wires it to Mission Control cards.

Key constraint: Button only shows when project has non-empty localPath.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/actions/preview-actions.ts` — `openInTerminal(worktreePath: string)` uses `execFileSync("open", ["-a", terminalApp, worktreePath])`
- `src/components/missions/mission-card.tsx` — Mission Control card component
- `src/components/task/terminal-portal.tsx` — existing terminal open usage

### Established Patterns
- Ghost icon buttons in toolbars: `h-8 w-8 p-0 text-muted-foreground hover:bg-accent hover:text-foreground`
- All text uses `t("key")` from useI18n()
- Toast for errors via Sonner

### Integration Points
- `mission-card.tsx` — add button to card toolbar/actions area
- `openInTerminal` — call with project's localPath

</code_context>

<specifics>
## Specific Ideas

- Reuse existing `openInTerminal` from preview-actions.ts (STATE.md decision)
- Button text: "在终端打开" (i18n key likely already exists)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
