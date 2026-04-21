# Phase 62: Project Analysis - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Mode:** Auto-generated (--auto flag, recommendations accepted)

<domain>
## Phase Boundary

Deliver a "生成描述" button that analyzes a project's local directory using Claude CLI and auto-fills the description textarea with structured Markdown. The button appears in both create-project and import-project dialogs, disabled when no localPath is available.

</domain>

<decisions>
## Implementation Decisions

### Button Placement & Behavior
- Create form: "生成描述" button appears next to the clone button (below localPath area)
- Import form: "生成描述" button appears below the localPath field
- Button disabled (greyed out) when localPath is empty or project not yet cloned
- Disabled state shows tooltip "请先选择路径" on hover
- Loading indicator on button during analysis (spinner icon + text change)

### Analysis Implementation
- Use a server action (not API route) for the analysis — consistent with existing action patterns
- The server action spawns `claude` CLI with a specific prompt to analyze the directory
- Analysis prompt instructs Claude to read package.json, README, src/ structure, detect monorepo
- Output format: structured Markdown with tech stack, module breakdown, and MCP subPath guidance
- Use `execFile` (child_process) for one-shot analysis, NOT PTY session — this is a single request/response, not interactive
- Timeout: 30 seconds max, show error toast on timeout

### Output Format
- Returns structured Markdown that auto-fills the description textarea
- Format includes: tech stack, main modules/packages, entry points, and optional MCP subPath suggestions
- User can edit the generated description before submitting

### Claude's Discretion
- Exact prompt wording for the Claude CLI analysis call
- Whether to cache analysis results for the same localPath
- Error handling UX details (retry button vs just toast)
- Whether to use `claude --print` flag or pipe stdout

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/claude-session.ts` — has path encoding, session dir finding, execFile usage
- `src/actions/agent-actions.ts` — has startPtyExecution pattern for spawning Claude CLI
- `src/components/project/create-project-dialog.tsx` — target for button in create form
- `src/components/project/import-project-dialog.tsx` — target for button in import form
- base-ui Tooltip component — for disabled button tooltip

### Established Patterns
- Server actions in `src/actions/` — async functions with error handling
- Toast notifications via Sonner for success/error feedback
- Loading states use opacity overlay + spinner pattern
- All text uses `t("key")` from useI18n()

### Integration Points
- `create-project-dialog.tsx` — add button after clone button area
- `import-project-dialog.tsx` — add button below localPath field
- New server action file or extend existing `project-actions.ts`
- i18n keys for button text, tooltip, loading state, error messages

</code_context>

<specifics>
## Specific Ideas

- User stated: "生成描述后是自动回显到 description 输入框" — analysis result auto-fills textarea
- User stated: use Claude CLI to analyze localPath directory structure
- One CLI analysis call populates description textarea (from STATE.md decisions)

</specifics>

<deferred>
## Deferred Ideas

- startCommand / startPort / packageManager / workDir fields on Project (deferred to Preview milestone)
- Preview functionality (deferred to separate milestone)

</deferred>
