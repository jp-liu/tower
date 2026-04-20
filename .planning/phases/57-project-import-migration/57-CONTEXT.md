# Phase 57: Project Import & Migration - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous --auto)

<domain>
## Phase Boundary

Enable clean project onboarding: create from git URL (auto-clone if needed), import existing folder (auto-detect remote), and optional atomic migration to a canonical path derived from git URL rules.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — --auto mode accepted all recommendations. Success criteria are well-defined in ROADMAP with 6 specific verification points.

Key technical notes:
- Reuse existing `src/lib/git-url.ts` for path derivation (gitUrlToLocalPath, toCloneUrl, parseGitUrl)
- Reuse existing `createProject` server action — extend with git clone logic
- Import flow: folder browser dialog → detect .git/config → extract remote → auto-fill fields
- Migration: atomic fs.rename() with pre-flight safety checks (no running executions/PTY/worktrees)
- Safety: block migration if active sessions exist, leave source intact on any error

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/git-url.ts` — gitUrlToLocalPath(), toCloneUrl(), parseGitUrl(), matchGitPathRule()
- `src/actions/workspace-actions.ts` — createProject() server action
- `src/components/layout/folder-browser-dialog.tsx` — folder picker dialog
- `src/lib/worktree.ts` — worktree management utilities
- `src/actions/agent-actions.ts` — getActiveExecutionsAcrossWorkspaces()

### Established Patterns
- Server actions for data mutations
- Dialog components from shadcn
- i18n for all user-facing text
- Toast for success/error notifications

### Integration Points
- Project creation dialogs (likely in board-page-client or a settings area)
- Workspace actions for project CRUD
- PTY session store for checking active sessions

</code_context>

<specifics>
## Specific Ideas

No specific requirements — fixes are precisely defined by success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
