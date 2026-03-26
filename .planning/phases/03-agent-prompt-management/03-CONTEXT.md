# Phase 3: Agent Prompt Management - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning
**Mode:** auto (no prior discuss-phase; decisions derived from requirements + research)

<domain>
## Phase Boundary

Replace the "Prompts — Coming in Phase 3" placeholder in the Settings page with a full CRUD UI for AgentPrompt. Users can list, create, edit, delete, and designate a default prompt from the Prompts settings panel.

</domain>

<decisions>
## Implementation Decisions

### Auto-resolved (no prior discuss-phase — defaults for --auto mode)

### isDefault Behavior
- **D-01:** Users CAN unset the default (no prompt is default is valid). Use radio-button pattern where "Default" is an on/off toggle per prompt, not mutually exclusive radio buttons.
- **D-02:** Creating a new prompt does NOT auto-set it as default.
- **D-03:** The `isDefault` enforcement requires `db.$transaction()` to clear other defaults first — this was pre-decided in STATE.md: "[Pre-Phase 3]: isDefault enforcement requires db.$transaction() to clear other defaults first".

### UI Structure
- **D-04:** Prompts list as a Card with prompt rows showing name, description snippet, and default badge/star. Inline "Set Default" button per prompt row.
- **D-05:** Create/Edit via Dialog component (matching existing dialog patterns in codebase).
- **D-06:** Delete with confirmation Dialog before executing delete.

### i18n
- **D-07:** All new strings via `t()` — add `settings.prompts.*` keys in both zh and en locales.

### Claude's Discretion
- Exact card layout, spacing, and grouping
- Delete confirmation dialog text
- Default star/badge visual style
- Form field labels and placeholders

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Backend
- `src/actions/prompt-actions.ts` — Existing CRUD server actions (getPrompts, createPrompt, updatePrompt, deletePrompt)
- `prisma/schema.prisma` — AgentPrompt model (id, name, description, content, isDefault, workspaceId)
- STATE.md — "[Pre-Phase 3]: isDefault enforcement requires db.$transaction() to clear other defaults first"

### Frontend Patterns
- `src/components/settings/ai-tools-config.tsx` — Reference pattern for settings panel
- `src/components/settings/general-config.tsx` — Minimal settings panel reference
- `src/app/settings/page.tsx` — Settings routing with activeSection state
- `src/lib/i18n.tsx` — Translation system (add `settings.prompts.*` keys)

### Prior Phases
- `.planning/phases/01-theme-general-settings/01-CONTEXT.md` — Settings nav structure (General/AI Tools/Prompts)
- `.planning/phases/02-cli-adapter-verification/02-CONTEXT.md` — i18n pattern, component patterns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Dialog`, `Card`, `CardContent`, `Button`, `Badge` shadcn/ui components — used throughout codebase
- `prompt-actions.ts` — 4 of 5 CRUD actions already exist (getPrompts, createPrompt, updatePrompt, deletePrompt)
- `settings/page.tsx` — already has `activeSection === "prompts"` branch with placeholder

### What Needs to be Built
- `setDefaultPrompt(promptId)` server action with `db.$transaction()`
- `settings/prompts-config.tsx` client component with full CRUD UI
- `settings/prompts-dialog.tsx` (or inline) for create/edit form
- i18n keys for all prompt management strings
- Wire component into settings/page.tsx

### Integration Points
- `settings/page.tsx`: Replace placeholder with `<PromptsConfig />`
- `prompt-actions.ts`: Add `setDefaultPrompt` action
- `i18n.tsx`: Add `settings.prompts.*` translation keys

</code_context>

<specifics>
## Specific Ideas

- No specific examples — standard CRUD UI approach
</specifics>

<deferred>
## Deferred Ideas

None — Phase 3 scope is complete CRUD for prompts.

</deferred>

---

*Phase: 03-agent-prompt-management*
*Context gathered: 2026-03-26*
