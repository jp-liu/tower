---
phase: 41-paste-ux-thumbnail-strip
plan: "01"
subsystem: assistant-ui
tags: [hook, component, upload, i18n, xhr]
dependency_graph:
  requires: [40-image-upload-api]
  provides: [useImageUpload, ImageThumbnailStrip, ImagePreviewModal]
  affects: [assistant-chat]
tech_stack:
  added: []
  patterns: [XHR upload with progress, blob URL lifecycle management, base-ui Dialog render prop]
key_files:
  created:
    - src/hooks/use-image-upload.ts
    - src/components/assistant/image-thumbnail-strip.tsx
    - src/components/assistant/image-preview-modal.tsx
  modified:
    - src/lib/i18n.tsx
decisions:
  - Use XMLHttpRequest (not fetch) for upload progress tracking via xhr.upload.onprogress
  - Store XHR instances in useRef<Map> (not state) to avoid re-renders on abort
  - Cleanup useEffect pattern uses imagesRef to avoid setState inside cleanup function (React 19 warning)
  - DialogClose uses render= prop (base-ui pattern) not asChild (Radix pattern)
metrics:
  duration: "~2 minutes"
  completed: "2026-04-18T12:30:57Z"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 41 Plan 01: Paste UX Foundation — Hook + Components Summary

**One-liner:** XHR upload hook with blob URL lifecycle management, 48px thumbnail strip with progress/error overlays, and fullscreen zoom dialog using base-ui render prop pattern.

## What Was Built

### Task 1: useImageUpload hook + i18n keys

Created `src/hooks/use-image-upload.ts` with:
- `PendingImage` interface exported for consumer components
- `useImageUpload()` hook returning `{ pendingImages, addImages, removeImage, clearAll, hasUploading }`
- XMLHttpRequest-based upload to `/api/internal/assistant/images` with `xhr.upload.onprogress` progress tracking
- XHR instances stored in `useRef<Map<string, XMLHttpRequest>>` — not state, to avoid re-renders
- `removeImage` aborts in-flight XHR and revokes blob URL atomically
- `clearAll` aborts all XHRs, revokes all blob URLs, resets state
- Cleanup `useEffect` with `imagesRef` pattern to avoid `setState` inside cleanup (React 19 compliant)
- All state updates are immutable (spread/map/filter)

Added 5 new i18n keys to `src/lib/i18n.tsx` in both zh and en sections:
- `assistant.removeImage`
- `assistant.uploadFailed`
- `assistant.uploadFailedRemoveHint`
- `assistant.closePreview`
- `assistant.inputPlaceholderWithImages`

### Task 2: ImageThumbnailStrip + ImagePreviewModal components

Created `src/components/assistant/image-thumbnail-strip.tsx`:
- Returns `null` when `pendingImages.length === 0` (no layout shift)
- 48px square thumbnails (`h-12 w-12`) with `ring-border` / `ring-destructive` state
- Progress overlay with `bg-primary` progress bar, `role="progressbar"` aria attrs, `text-[10px] font-semibold text-white` percentage display
- Error overlay with `AlertCircle` icon centered
- X remove button always visible with `e.stopPropagation()` and tooltip on error state
- Click handler calls `onPreview` only when status is not "uploading" (cursor-wait when uploading)

Created `src/components/assistant/image-preview-modal.tsx`:
- Uses `Dialog` + `DialogContent` with `showCloseButton={false}` and `bg-black/90` backdrop
- `DialogClose` uses `render={}` prop (base-ui pattern, NOT `asChild` which is Radix)
- Internal `zoomed` state toggled on image click: `cursor-zoom-in` / `cursor-zoom-out`
- `useEffect([open])` resets zoom state on open/close

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — these are standalone building blocks with no data source stubs. Plan 02 will wire them into `AssistantChat`.

## Self-Check

### Files exist:
- `src/hooks/use-image-upload.ts` — FOUND
- `src/components/assistant/image-thumbnail-strip.tsx` — FOUND
- `src/components/assistant/image-preview-modal.tsx` — FOUND

### Commits exist:
- `0b77a86` — Task 1: useImageUpload hook + i18n keys
- `9e1990f` — Task 2: ImageThumbnailStrip and ImagePreviewModal

## Self-Check: PASSED
