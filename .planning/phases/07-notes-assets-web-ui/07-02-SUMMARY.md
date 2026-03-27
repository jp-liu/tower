---
phase: 07-notes-assets-web-ui
plan: 02
subsystem: ui
tags: [assets, file-upload, image-preview, next.js, react, i18n, vitest]

# Dependency graph
requires:
  - phase: 04-data-layer-foundation
    provides: ProjectAsset Prisma model, createAsset/deleteAsset/getProjectAssets server actions
  - phase: 06-file-serving-image-rendering
    provides: localPathToApiUrl, /api/files/assets/ serving route
  - phase: 07-notes-assets-web-ui/07-01
    provides: assets.* i18n keys, Assets sidebar navigation link
provides:
  - Assets page at /workspaces/[workspaceId]/assets with full CRUD
  - uploadAsset server action with duplicate-filename protection
  - AssetItem component with image preview or file icon, download, delete
  - AssetList component with empty state handling
  - AssetUpload component with file input trigger and uploading state
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server Component page.tsx fetches data, passes to Client Component — same pattern as notes page"
    - "AssetItemType interface exported from asset-item.tsx and reused in asset-list.tsx"
    - "FormData uploadAsset server action writes file to disk then creates DB record"
    - "Duplicate filename protection: append -${Date.now()} suffix before extension"

key-files:
  created:
    - src/actions/asset-actions.ts (uploadAsset added)
    - src/components/assets/asset-item.tsx
    - src/components/assets/asset-list.tsx
    - src/components/assets/asset-upload.tsx
    - src/app/workspaces/[workspaceId]/assets/page.tsx
    - src/app/workspaces/[workspaceId]/assets/assets-page-client.tsx
    - tests/unit/components/asset-item.test.tsx
    - tests/unit/components/asset-list.test.tsx
  modified:
    - src/actions/asset-actions.ts (fixed revalidatePath, added uploadAsset)

key-decisions:
  - "Fixed pre-existing bug: revalidatePath('/workspace') → revalidatePath('/workspaces') in createAsset and deleteAsset (Rule 1)"
  - "AssetItemType interface co-located in asset-item.tsx and exported for reuse in asset-list.tsx"
  - "uploadAsset appends -${Date.now()} suffix before extension for duplicate filenames — same overwrite-safe approach as MCP manage_assets"

patterns-established:
  - "AssetItemType interface exported from component file and reused across sibling components"
  - "All asset sub-components use useI18n for bilingual string support"
  - "Test files use renderWithI18n helper wrapping I18nProvider (consistent with notes tests)"

requirements-completed: [UI-02]

# Metrics
duration: 15min
completed: 2026-03-27
---

# Phase 07 Plan 02: Assets Web UI Summary

**Assets management UI at /workspaces/[id]/assets with image thumbnail preview, file upload (overwrite-safe), download links, delete confirmation, project selector, and bilingual i18n**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-27T10:25:56Z
- **Completed:** 2026-03-27T10:28:33Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added uploadAsset server action with FormData handling, disk write, and timestamp-suffix overwrite protection
- Built full Assets page: server component + client component + 3 sub-components (AssetItem, AssetList, AssetUpload)
- 10 unit tests passing for AssetItem and AssetList components

## Task Commits

1. **Task 1: Add uploadAsset server action and create asset components** - `8c0eccf` (feat)
2. **Task 2: Build Assets page with server and client components** - `7e94944` (feat)
3. **Task 3: Create unit tests for asset components** - `d201b5a` (test)

## Files Created/Modified

- `src/actions/asset-actions.ts` - Added uploadAsset; fixed revalidatePath /workspace → /workspaces
- `src/components/assets/asset-item.tsx` - Single asset row with image preview or FileText icon, download link, delete button
- `src/components/assets/asset-list.tsx` - Asset list with empty state (FolderOpen icon + i18n text)
- `src/components/assets/asset-upload.tsx` - File upload button with hidden input, isUploading state
- `src/app/workspaces/[workspaceId]/assets/page.tsx` - Server component: fetches workspace/projects/assets with Next.js 16 Promise params
- `src/app/workspaces/[workspaceId]/assets/assets-page-client.tsx` - Client component: project selector, upload button, asset list, delete confirm dialog
- `tests/unit/components/asset-item.test.tsx` - 6 tests: filename, size KB formatting, image thumbnail, file icon, download attrs, onDelete callback
- `tests/unit/components/asset-list.test.tsx` - 4 tests: empty state text, empty hint, multiple items, no empty state when present

## Decisions Made

- Fixed pre-existing bug in createAsset/deleteAsset: revalidatePath was using `/workspace` (singular) instead of `/workspaces` (plural). Applied as Rule 1 auto-fix.
- AssetItemType interface co-located in asset-item.tsx and exported for reuse in asset-list.tsx — same pattern as NoteItem from Plan 01.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed revalidatePath from /workspace to /workspaces**
- **Found during:** Task 1 (uploadAsset server action)
- **Issue:** createAsset and deleteAsset were calling revalidatePath('/workspace') — missing the 's'. This would cause Next.js cache invalidation to miss the actual workspace routes.
- **Fix:** Changed both to revalidatePath('/workspaces') as documented in plan critical notes
- **Files modified:** src/actions/asset-actions.ts
- **Verification:** grep "revalidatePath.*\/workspaces" passes
- **Committed in:** 8c0eccf (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Critical correction ensuring cache revalidation works on correct paths. No scope creep.

## Issues Encountered

None — all components built and tests passed on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 07 is now complete (both plans 07-01 and 07-02 done)
- Assets page is fully functional; users can navigate, upload, preview, download, and delete project files
- v0.2 milestone (项目知识库 & 智能 MCP) is complete

---
*Phase: 07-notes-assets-web-ui*
*Completed: 2026-03-27*
