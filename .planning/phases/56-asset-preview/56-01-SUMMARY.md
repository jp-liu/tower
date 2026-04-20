---
phase: 56-asset-preview
plan: 01
subsystem: ui
tags: [react, dialog, markdown, lightbox, i18n, internal-api]

requires:
  - phase: none
    provides: standalone building blocks
provides:
  - ImageLightbox component with zoom/pan for fullscreen image preview
  - TextPreviewDialog component with markdown/JSON/text rendering
  - POST /api/internal/assets/reveal for opening files in system file manager
  - 5 new i18n keys for asset preview features
affects: [56-asset-preview plan 02 wiring]

tech-stack:
  added: []
  patterns: [scroll-to-pan via overflow-auto, platform-aware execFile, size-guarded text fetch]

key-files:
  created:
    - src/components/assets/image-lightbox.tsx
    - src/components/assets/text-preview-dialog.tsx
    - src/app/api/internal/assets/reveal/route.ts
  modified:
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts

key-decisions:
  - "ReactMarkdown className prop removed in newer version - wrapped in div with prose classes instead"

patterns-established:
  - "Lightbox zoom pattern: boolean state toggle between object-contain and overflow-auto scroll-to-pan"
  - "Text preview size guard: check content-length header and text length against 1MB limit"

requirements-completed: [ASSET-01, ASSET-02, ASSET-03]

duration: 3min
completed: 2026-04-20
---

# Phase 56 Plan 01: Asset Preview Building Blocks Summary

**Image lightbox with zoom/pan, text/md/json preview dialog, and reveal-in-Finder API route with platform detection**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-20T15:55:37Z
- **Completed:** 2026-04-20T15:58:53Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- ImageLightbox component with zoom toggle (cursor-zoom-in/out) and scroll-to-pan via native overflow-auto
- TextPreviewDialog component that fetches content and renders .md as markdown (ReactMarkdown+remarkGfm), .json as formatted JSON, and .txt as monospace pre
- Reveal API route with localhost guard, data/assets/ path validation, and platform-aware commands (open -R, xdg-open, explorer /select)
- All 5 i18n keys added to both zh.ts and en.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Image lightbox and text preview components** - `661304c` (feat)
2. **Task 2: Reveal in Finder API route** - `c66bff4` (feat)
3. **Task 3: Add i18n keys for asset preview** - `b08d40a` (feat)

## Files Created/Modified
- `src/components/assets/image-lightbox.tsx` - Fullscreen image viewer with zoom toggle and scroll-to-pan
- `src/components/assets/text-preview-dialog.tsx` - Text/Markdown/JSON preview dialog with size guard
- `src/app/api/internal/assets/reveal/route.ts` - POST endpoint to reveal file in system file manager
- `src/lib/i18n/zh.ts` - Added 5 asset preview keys (Chinese)
- `src/lib/i18n/en.ts` - Added 5 asset preview keys (English)

## Decisions Made
- Used div wrapper for ReactMarkdown prose classes (className prop removed in newer react-markdown version) - matches note-card.tsx pattern
- Size guard checks both content-length header and text length for double protection against large files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ReactMarkdown className prop removed**
- **Found during:** Task 1 (Text preview component)
- **Issue:** Plan specified `className` directly on ReactMarkdown, but newer version removed this prop
- **Fix:** Wrapped ReactMarkdown in a div with the prose classes, matching existing note-card.tsx pattern
- **Files modified:** src/components/assets/text-preview-dialog.tsx
- **Verification:** TypeScript compilation passes with no errors
- **Committed in:** 661304c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor adjustment, identical visual output. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all components are fully functional building blocks ready for Plan 02 wiring.

## Next Phase Readiness
- All three building blocks ready for Plan 02 to wire into the existing asset list UI
- ImageLightbox exports the component for direct import
- TextPreviewDialog exports the component for direct import
- Reveal API route is live at POST /api/internal/assets/reveal

---
*Phase: 56-asset-preview*
*Completed: 2026-04-20*
