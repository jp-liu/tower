---
phase: 42
plan: 01
subsystem: assistant-chat
tags: [chat, images, ui, i18n]
dependency_graph:
  requires: []
  provides: [ChatMessage.imageFilenames, UserBubble image rendering]
  affects: [assistant-chat-bubble, use-assistant-chat, i18n]
tech_stack:
  added: []
  patterns: [broken-image fallback sub-component, optional prop drilling]
key_files:
  created: []
  modified:
    - src/hooks/use-assistant-chat.ts
    - src/components/assistant/assistant-chat-bubble.tsx
    - src/lib/i18n.tsx
decisions:
  - MessageImage as self-contained sub-component (manages own broken state, no prop drilling of error state)
  - CSS calc for max-width instead of Tailwind class to express 4-image-row constraint precisely
metrics:
  duration: "1 minute"
  completed_date: "2026-04-18"
  tasks_completed: 2
  files_modified: 3
requirements: [MSG-01, MSG-03]
---

# Phase 42 Plan 01: ChatMessage Image Type + UserBubble Image Rendering Summary

**One-liner:** Extended ChatMessage type with imageFilenames field and updated UserBubble to render 64x64 images with ImageOff broken-image fallback and click-to-preview callback.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend ChatMessage type and add i18n keys | 63172cf | use-assistant-chat.ts, i18n.tsx |
| 2 | Update UserBubble to render images with broken-image fallback | e9b91cd | assistant-chat-bubble.tsx |

## What Was Built

### ChatMessage Type Extension (Task 1)

Added `imageFilenames?: string[]` to the `ChatMessage` interface in `src/hooks/use-assistant-chat.ts`. This optional field carries an array of server-side cache filenames that were attached when the user sent a message.

### i18n Keys (Task 1)

Added to both `zh` and `en` translation sections in `src/lib/i18n.tsx`:
- `assistant.brokenImage`: "图片不可用" / "Image unavailable"
- `assistant.imageCount`: "张图片" / "image(s)"

### MessageImage Sub-component (Task 2)

New `MessageImage` component in `assistant-chat-bubble.tsx`:
- Manages its own `broken` boolean state via `useState`
- Renders a `<button>` wrapper with a `<img loading="lazy">` in normal state
- On `onError` event, sets `broken = true` and renders a grey div with `<ImageOff>` icon
- `title` attribute uses `t("assistant.brokenImage")` for accessibility
- Passes click through `onPreview` callback

### UserBubble Update (Task 2)

Updated `UserBubble` signature to accept:
- `imageFilenames?: string[]`
- `onImagePreview?: (url: string) => void`

Images render BEFORE text content in a `flex flex-wrap gap-1.5 mb-2` container. Max 4 per row enforced via `style={{ maxWidth: "calc(4 * 64px + 3 * 6px)" }}`. Each image is 64x64 (`size-16`) with `object-cover` and rounded corners.

### AssistantChatBubble Prop Threading (Task 2)

Added `onImagePreview?: (url: string) => void` to `AssistantChatBubbleProps` and passed it through to `UserBubble` along with `message.imageFilenames`.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The `imageFilenames` field is wired from the ChatMessage type through to the render. However, the source of the data (the hook's `sendMessage` function creating messages with `imageFilenames` populated) is out of scope for this plan — that will be handled in a subsequent plan when the image paste/upload feature sends filenames. The rendering code is ready and will work correctly once `imageFilenames` is populated.

## Self-Check: PASSED

Files verified:
- `src/hooks/use-assistant-chat.ts`: `imageFilenames?: string[]` present
- `src/lib/i18n.tsx`: `assistant.brokenImage` and `assistant.imageCount` in both zh and en sections
- `src/components/assistant/assistant-chat-bubble.tsx`: `ImageOff`, `MessageImage`, `onImagePreview`, `imageFilenames`, `onError(() => setBroken(true))`, `size-16`, `loading="lazy"` all present

Commits verified:
- 63172cf: feat(msg-42.01): extend ChatMessage type with imageFilenames and add i18n keys
- e9b91cd: feat(msg-42.01): update UserBubble to render images with broken-image fallback
