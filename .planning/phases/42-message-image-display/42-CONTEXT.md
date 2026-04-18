# Phase 42: Message Image Display - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** Auto-generated (--auto flag, recommendations auto-accepted)

<domain>
## Phase Boundary

Sent messages containing images render the images inline in the chat bubble, with graceful handling of missing images and session reload. This phase modifies the user bubble to display images at the top, reuses the ImagePreviewModal from Phase 41 for zoom, adds broken-image placeholder handling, and ensures image references survive session history reload.

</domain>

<decisions>
## Implementation Decisions

### Image Display in User Bubbles
- Modify `UserBubble` in `assistant-chat-bubble.tsx` to accept and render image filenames
- Images render at the TOP of the bubble (before text content), in a horizontal flex row
- Each image is fixed-size: 64px × 64px with `object-cover` and `rounded-md`
- Image src uses `/api/internal/cache/<filename>` path (Phase 40 serving route)
- Max 4 images per row, wrap to next row if more

### ChatMessage Type Extension
- Extend `ChatMessage` interface in `use-assistant-chat.ts` to include optional `imageFilenames?: string[]`
- When sending a message with images, `imageFilenames` is stored in the message object
- Provider already includes `imageFilenames` in the chat API POST body (Phase 41)

### Preview Modal Reuse
- Reuse `ImagePreviewModal` from Phase 41 (already in `assistant-chat-bubble.tsx`'s parent scope)
- Click on a message image opens the preview modal with zoom support
- Pass preview state up from bubble to chat component via callback prop `onImagePreview?: (url: string) => void`

### Broken Image Handling
- Use `<img onError>` handler to show a broken-image placeholder
- Placeholder: grey background with `ImageOff` icon from lucide-react, same 64px × 64px size
- No retry mechanism — broken images stay as placeholders until cache is restored

### Session History Reload
- `imageFilenames` is stored in the chat API response and persisted in session history
- When loading history via `loadSessionHistory`, messages with `imageFilenames` render images correctly
- Image URLs are relative paths (`/api/internal/cache/<filename>`), so they work on any host

### Claude's Discretion
- Image gap/spacing between thumbnails in the bubble
- Whether to show image count badge if images are collapsed

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/assistant/assistant-chat-bubble.tsx` — `UserBubble`, `AssistantBubble`, `ToolBubble`, `ThinkingBubble` components
- `src/components/assistant/image-preview-modal.tsx` — Fullscreen zoom modal from Phase 41
- `src/hooks/use-assistant-chat.ts` — `ChatMessage` type definition
- `/api/internal/cache/[filename]/route.ts` — Phase 40 image serving route

### Established Patterns
- Bubbles use `max-w-[80%]` for user, `max-w-[85%]` for assistant
- User bubble: `bg-primary text-primary-foreground rounded-2xl rounded-br-sm`
- i18n: all user-facing text uses `t("key")`
- Messages rendered via `messages.map((m) => <AssistantChatBubble key={m.id} message={m} />)`

### Integration Points
- `assistant-chat-bubble.tsx` — Add image rendering to `UserBubble`
- `use-assistant-chat.ts` — Extend `ChatMessage` type with `imageFilenames`
- `assistant-chat.tsx` — Pass `onImagePreview` callback and manage preview state for message images
- `assistant-provider.tsx` — Ensure `imageFilenames` flows through message creation

</code_context>

<specifics>
## Specific Ideas

- Image size in message bubbles: 64px × 64px (larger than upload thumbnails at 48px, to show more detail in sent messages)
- Use `img` element with `loading="lazy"` for performance on long chat histories

</specifics>

<deferred>
## Deferred Ideas

- Inline markdown image positioning (out of scope per REQUIREMENTS.md)
- Image lightbox gallery (swipe between images) — future enhancement

</deferred>
