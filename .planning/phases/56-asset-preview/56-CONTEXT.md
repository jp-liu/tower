# Phase 56: Asset Preview - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous --auto)

<domain>
## Phase Boundary

Enable in-browser asset inspection: image lightbox with zoom/pan, text/md/json preview dialogs, and system file manager integration. Replace Download button with Preview + Reveal in Finder.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — --auto mode accepted all recommendations. Success criteria are well-defined in ROADMAP.

Key technical notes:
- Reuse existing `ImagePreviewModal` component (already has zoom toggle) for image lightbox
- Create a new `TextPreviewDialog` for .txt/.md/.json (render .md as Markdown, others as monospace)
- Add `/api/internal/assets/reveal` API route to call `open` (macOS) or equivalent to reveal file in Finder
- Modify `AssetItem` to replace Download with Preview + Reveal in Finder buttons

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/assistant/image-preview-modal.tsx` — Dialog-based image viewer with zoom toggle
- `src/components/assets/asset-item.tsx` — Current asset row with Download + Delete buttons
- `src/components/assets/asset-list.tsx` — List wrapper using shared EmptyState
- `src/lib/file-serve-client.ts` — `localPathToApiUrl()` for serving local files

### Established Patterns
- Dialog component from shadcn for modals
- Icon buttons: `rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground`
- i18n for all user-facing text

### Integration Points
- `AssetItem` component needs new action buttons
- New API route for file reveal (shell command)
- New preview components imported into asset page

</code_context>

<specifics>
## Specific Ideas

No specific requirements — fixes are precisely defined by success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
