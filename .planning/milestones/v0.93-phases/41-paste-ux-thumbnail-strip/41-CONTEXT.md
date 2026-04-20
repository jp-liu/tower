# Phase 41: Paste UX & Thumbnail Strip - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** Auto-generated (--auto flag, recommendations auto-accepted)

<domain>
## Phase Boundary

Users can paste one or more images into the chat input and see thumbnails with progress indicators before sending. This phase adds clipboard paste handling, image upload integration with the Phase 40 API, thumbnail strip UI above the input, preview modal, and textarea height behavior.

</domain>

<decisions>
## Implementation Decisions

### Paste Event Handling
- Add `onPaste` handler to the existing `<Textarea>` in `assistant-chat.tsx`
- Use `clipboardData.items` (not `.files`) to extract image data (Firefox compatibility per PASTE-06)
- Filter for `type.startsWith("image/")` items only — text paste passes through unaffected
- Convert clipboard item to `File` via `.getAsFile()`, then upload to `/api/internal/assistant/images`

### Upload & State Management
- Create `useImageUpload` custom hook to manage pending images state
- Each pending image has: `{ id: string, file: File, blobUrl: string, status: "uploading" | "done" | "error", progress: number, filename?: string }`
- Use `XMLHttpRequest` (not fetch) for upload to track progress via `xhr.upload.onprogress`
- On successful upload, store the returned `filename` from the Phase 40 API response
- On send: include uploaded `filename` values in the message payload, then clear all pending images
- Revoke `URL.createObjectURL()` blob URLs on remove and on component unmount (memory cleanup)

### Thumbnail Strip UI
- Render a horizontal flex row of 48px thumbnails above the input area (between border-t and textarea)
- Only render the strip when pending images exist (no layout shift when empty)
- Each thumbnail shows: image preview (object-cover), progress bar overlay (percentage during upload), X button (top-right) for removal
- Use `rounded-md` corners, `ring-1 ring-border` for thumbnail container
- X button: absolute positioned, `h-4 w-4`, uses lucide `X` icon, same ghost hover pattern as icon buttons in ui.md

### Preview Modal
- Click on a thumbnail opens a fullscreen preview modal
- Use shadcn `Dialog` component for the modal
- Display the image centered with max-width/max-height constraints
- Support zoom: click to toggle between fit-to-screen and 100% natural size
- No additional zoom controls (pinch-to-zoom is browser-native)

### Textarea Height Behavior
- Default to `rows={3}` (per PASTE-07, changing from current `rows={1}`)
- Max height: 5 rows equivalent, then scrollbar appears
- Use CSS `min-h-[72px]` (3 rows × ~24px) and `max-h-[120px]` (5 rows × ~24px)
- Keep `resize-none` to prevent manual resize

### Claude's Discretion
- Progress bar visual style (thin bar at bottom of thumbnail vs radial)
- Exact animation for upload completion (fade out progress bar)
- Whether to show a subtle "paste image" hint in the input area

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/assistant/assistant-chat.tsx` — Main chat component with textarea input, `handleSend`, `handleKeyDown`
- `src/components/assistant/assistant-provider.tsx` — Chat state provider with `sendChatMessage`
- `src/components/ui/dialog.tsx` — shadcn Dialog component for preview modal
- `src/components/ui/textarea.tsx` — shadcn Textarea component
- Phase 40 upload API at `/api/internal/assistant/images` — POST with FormData, returns `{ filename, mimeType }`

### Established Patterns
- UI components follow shadcn conventions with TailwindCSS 4
- Icon buttons use ghost variant with `h-8 w-8 p-0 text-muted-foreground` (per ui.md rules)
- All user-facing text uses `t("key")` from `useI18n()`
- Component state lifted to provider when it needs to persist across routes

### Integration Points
- `assistant-chat.tsx` — Add paste handler and thumbnail strip to existing input area
- `assistant-provider.tsx` — May need to accept `images: string[]` (filenames) in `sendChatMessage`
- Phase 42 will display images in message bubbles using the filenames stored in messages

</code_context>

<specifics>
## Specific Ideas

- Thumbnail size: exactly 48px square (per success criteria)
- Use `URL.createObjectURL()` for instant preview while upload is in progress
- Progress percentage overlay: semi-transparent dark background with white text

</specifics>

<deferred>
## Deferred Ideas

- Drag-and-drop upload (FILE-02) — future milestone
- Non-image file paste support (FILE-01) — future milestone
- Image reordering within thumbnail strip — not in requirements

</deferred>
