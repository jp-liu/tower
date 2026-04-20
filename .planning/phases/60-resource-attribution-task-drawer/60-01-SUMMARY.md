---
phase: 60-resource-attribution-task-drawer
plan: 01
subsystem: ui
tags: [prisma, react, sheet, i18n, assets]

requires:
  - phase: 59-auto-upload-hook
    provides: task-bound assets with taskId foreign key
provides:
  - ProjectAssetWithTask type for enriched asset queries
  - TaskOverviewDrawer shared component for task quick preview
  - Task attribution badges on asset list items
affects: [60-02, archive-task-list]

tech-stack:
  added: []
  patterns: [drawer-from-badge-click, enriched-query-include-pattern]

key-files:
  created:
    - src/components/task/task-overview-drawer.tsx
  modified:
    - src/actions/asset-actions.ts
    - src/actions/task-actions.ts
    - src/components/assets/asset-item.tsx
    - src/components/assets/asset-list.tsx
    - src/app/workspaces/[workspaceId]/assets/assets-page-client.tsx
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts

key-decisions:
  - "TaskOverviewDrawer fetches data on open via getTaskOverview server action (not prop-drilled)"
  - "Asset query includes full task relation for badge rendering without extra requests"

patterns-established:
  - "Badge-to-drawer: clickable inline badge triggers Sheet drawer with entity overview"
  - "Enriched query type export: Prisma return type exported as named type for downstream consumers"

requirements-completed: [RES-01, RES-02, RES-03, RES-04]

duration: 5min
completed: 2026-04-20
---

# Phase 60 Plan 01: Resource Attribution & Task Drawer Summary

**Full asset visibility with task attribution badges and reusable TaskOverviewDrawer component for quick task preview from asset context**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-20T17:15:56Z
- **Completed:** 2026-04-20T17:21:28Z
- **Tasks:** 2/2
- **Files modified:** 8

## Accomplishments

### Task 1: Update asset query and create TaskOverviewDrawer component
- Removed `taskId: null` filter from `getProjectAssets` — now returns ALL project assets
- Added `include: { task: { select: ... } }` with labels, executions, asset count
- Exported `ProjectAssetWithTask` type
- Added `getTaskOverview` server action to task-actions.ts
- Created `TaskOverviewDrawer` Sheet component with status/priority badges, description, labels, creation date, resource count, last execution summary
- Added 8 i18n keys (zh + en) for taskDrawer namespace

### Task 2: Wire task badge into asset list and connect TaskOverviewDrawer
- Extended `AssetItemType` with optional `taskId`/`taskTitle` fields
- Rendered clickable blue badge beside filename for task-bound assets (title truncated to 20 chars)
- Added `onTaskClick` prop chain through AssetList to AssetItem
- Connected `TaskOverviewDrawer` in assets-page-client with state-driven open/close
- Mapped enriched Prisma response to AssetItemType with task data

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 2d36cb4 | feat(60-01.01): update asset query and create TaskOverviewDrawer component |
| 2 | 334dcd2 | feat(60-01.02): wire task badge into asset list and connect TaskOverviewDrawer |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all data sources wired, no placeholder content.
