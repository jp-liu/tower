---
phase: 64
plan: "02"
subsystem: search
tags: [code-search, monaco, ui-component, ripgrep, i18n]
dependency_graph:
  requires: [64-01]
  provides: [CodeSearch, CodeEditor.selectedLine]
  affects: [64-03-PLAN.md]
tech_stack:
  added: []
  patterns: [useCallback with abortRef, renderHighlighted submatch spans, Monaco revealLineInCenter with setTimeout]
key_files:
  created:
    - src/components/task/code-search.tsx
  modified:
    - src/components/task/code-editor.tsx
    - src/lib/i18n/zh.ts
    - src/lib/i18n/en.ts
decisions:
  - Added codeSearch.* i18n keys in Plan 02 (not 03) — TypeScript requires keys in zh.ts to compile
  - Abort ref pattern (abortRef.current = true) cancels stale search results on concurrent requests
  - submatch offset adjustment for trimStart() — compensates for leading whitespace stripped from display
metrics:
  duration: "164 seconds (~3 minutes)"
  completed: "2026-04-21"
  tasks_completed: 2
  files_count: 4
---

# Phase 64 Plan 02: CodeSearch UI Component Summary

**One-liner:** CodeSearch component with pattern/glob inputs, submatch highlighting (bg-yellow-400/30), and CodeEditor selectedLine prop for Monaco scroll-to-line navigation.

## What Was Built

### `src/components/task/code-search.tsx` (new)

"use client" component exposing `CodeSearch({ localPath, onResultSelect })`:

- **Two inputs:** pattern (Search icon, regex-capable) + glob filter (Filter icon) — stacked compact layout
- **Enter key on pattern** triggers `handleSearch()` via `handlePatternKeyDown`
- **Search execution:** calls `searchCode(localPath, pattern, glob?)` from `@/actions/search-code-actions`
- **Abort ref:** `abortRef.current = true` before each new search to discard stale results
- **`renderHighlighted(lineText, submatches)`:** splits line text into plain/highlighted spans using submatch start/end byte offsets; highlighted style `bg-yellow-400/30 text-yellow-200 rounded-[2px] px-[1px]`
- **Result row:** button per match showing `filePath` (muted), `:lineNumber` (accent), trimmed line text with highlights; click calls `onResultSelect(absolutePath, lineNumber)`
- **State variants:** no-localPath empty state, spinner (Loader2), error (red destructive text + toast for rg), no-results, truncated notice, initial hint
- **ScrollArea** wraps result list for overflow scrolling

### `src/components/task/code-editor.tsx` (modified)

- Added `selectedLine?: number | null` to `CodeEditorProps`
- Added `useEffect` on `[selectedLine, activeTabPath]`: calls `editor.revealLineInCenter(selectedLine)` + `editor.setPosition()` with 50ms setTimeout (Monaco model load timing); cleans up timer on unmount/re-run

### `src/lib/i18n/zh.ts` + `en.ts` (modified)

Added 8 `codeSearch.*` keys: patternPlaceholder, globPlaceholder, noPath, searching, noResults, truncated, hint, rgNotInstalled.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added i18n keys in Plan 02 (Plan said Plan 03)**
- **Found during:** Task 2 TypeScript compilation
- **Issue:** `t("codeSearch.*")` calls caused TypeScript errors — TranslationKey type derived from `zh.ts`, so keys must exist before component compiles
- **Fix:** Added all 8 `codeSearch.*` keys to both `zh.ts` and `en.ts` in this plan
- **Files modified:** `src/lib/i18n/zh.ts`, `src/lib/i18n/en.ts`
- **Commit:** f3702a1

## Commits

| Hash | Message |
|------|---------|
| df0b937 | feat(code-search-64.02): add selectedLine prop and revealLineInCenter useEffect to CodeEditor |
| f3702a1 | feat(code-search-64.02): create CodeSearch component with pattern/glob inputs and result highlighting |

## Known Stubs

None — both components are fully implemented. CodeSearch uses real `searchCode` server action. CodeEditor selectedLine wires to real Monaco API.

## Self-Check: PASSED
