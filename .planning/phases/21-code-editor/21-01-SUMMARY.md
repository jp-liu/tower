---
phase: 21-code-editor
plan: "01"
subsystem: editor-foundation
tags: [monaco, server-actions, i18n, file-io]
dependency_graph:
  requires: []
  provides: [monaco-packages, readFileContent, writeFileContent, editor-i18n-keys]
  affects: [src/actions/file-actions.ts, src/lib/i18n.tsx, package.json]
tech_stack:
  added: ["@monaco-editor/react@4.8.0-rc.3", "monaco-editor@0.55.1"]
  patterns: [zod-validation, safeResolvePath-security, server-actions]
key_files:
  created: []
  modified:
    - package.json
    - pnpm-lock.yaml
    - src/actions/file-actions.ts
    - src/lib/i18n.tsx
decisions:
  - "@monaco-editor/react@next (4.8.0-rc.3) installed — React 19 compatible, no webpack plugin added (Turbopack incompatible)"
  - "readFileContent/writeFileContent named to avoid collision with readFile/writeFile fs/promises imports"
  - "editor.* i18n keys inserted after last taskPage.fileTree.* key as per plan anchor"
metrics:
  duration: 780s
  completed_date: "2026-03-31"
  tasks_completed: 3
  files_modified: 4
requirements_satisfied: [ED-01, ED-02]
---

# Phase 21 Plan 01: Monaco Foundation — Summary

**One-liner:** Monaco Editor packages installed, readFileContent/writeFileContent server actions secured with safeResolvePath+zod, and 6 editor i18n keys added to both zh and en translation maps.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install Monaco Editor packages | 76ecfc2 | package.json, pnpm-lock.yaml |
| 2 | Add readFileContent and writeFileContent server actions | 9174c86 | src/actions/file-actions.ts |
| 3 | Add editor i18n keys to both zh and en translation maps | 9f949f8 | src/lib/i18n.tsx |

## What Was Built

### Monaco Package Installation
- `@monaco-editor/react@4.8.0-rc.3` — React 19 compatible (`next` tag per D-01)
- `monaco-editor@0.55.1` — peer dependency for types
- No webpack plugin added — Turbopack is the dev server (incompatible with MonacoWebpackPlugin)

### Server Actions (src/actions/file-actions.ts)
Two new exported server actions appended at the bottom of the file:

- **`readFileContent(worktreePath, relativePath): Promise<string>`** — reads a file from a worktree using `safeResolvePath` for path traversal prevention, zod schema validation
- **`writeFileContent(worktreePath, relativePath, content): Promise<void>`** — writes content to a worktree file with same security pattern

Both reuse already-imported `readFile`, `writeFile` (fs/promises), `safeResolvePath`, and `z`. No new imports were added.

### i18n Keys (src/lib/i18n.tsx)
6 editor.* keys added to both zh and en translation objects:

| Key | zh | en |
|-----|----|----|
| editor.selectFile | 选择文件以打开 | Select a file to open |
| editor.selectFileHint | 在左侧文件树中点击任意文件 | Click any file in the file tree on the left |
| editor.saveSuccess | 保存成功 | File saved |
| editor.saveError | 保存失败，请重试 | Save failed, please try again |
| editor.closeTab | 关闭标签页 | Close tab |
| editor.noWorktree | 暂无工作区，请先执行任务 | No worktree — run the task first |

## Deviations from Plan

None — plan executed exactly as written.

## Verification

All 5 overall verification checks pass:
1. `grep "@monaco-editor/react" package.json` — exits 0
2. `grep "export async function readFileContent" src/actions/file-actions.ts` — exits 0
3. `grep "export async function writeFileContent" src/actions/file-actions.ts` — exits 0
4. `grep -c "editor.saveSuccess" src/lib/i18n.tsx` — returns 2
5. TypeScript — no errors in modified files (pre-existing errors in agent-config-actions.ts are out of scope)

## Known Stubs

None.

## Self-Check: PASSED
