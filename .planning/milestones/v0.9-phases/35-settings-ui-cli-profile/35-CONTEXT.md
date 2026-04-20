# Phase 35: Settings UI for CLI Profile - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning
**Mode:** Auto-generated (simple UI phase — follows existing settings card patterns)

<domain>
## Phase Boundary

Users can view and edit the active CLI Profile directly in the Settings UI without touching the database.

</domain>

<decisions>
## Implementation Decisions

### Visual Pattern
- Follow existing settings card visual patterns (see SystemConfig cards in settings page)
- Bilingual zh/en using existing i18n system
- Inline editing with save button (not dialog)

### Claude's Discretion
All other implementation choices are at Claude's discretion. Use existing settings page patterns as the reference implementation.

</decisions>

<code_context>
## Existing Code Insights

Key files to examine:
- src/app/settings/page.tsx (Settings page layout)
- src/components/settings/ (Existing settings card components)
- src/lib/i18n.tsx (i18n translation system)
- prisma/schema.prisma (CliProfile model)
- src/actions/ (Existing server action patterns for CRUD)

</code_context>

<specifics>
## Specific Ideas

- Card should show: command, baseArgs (as editable list/text), envVars (as key-value pairs)
- Save updates the CliProfile default row in DB
- Next task execution automatically picks up changes (Phase 31 reads from DB)

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>
