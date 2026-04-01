---
phase: 21-code-editor
verified: 2026-03-31T10:00:00Z
status: human_needed
score: 5/5 must-haves verified (automated); 2 behaviors need human confirmation
re_verification: false
human_verification:
  - test: "Multi-tab editing preserves unsaved edits across tab switches"
    expected: "Switching from tab A (with unsaved edits) to tab B and back should show the original edits in tab A intact"
    why_human: "Implementation uses both value prop and editor.setModel() simultaneously. The @monaco-editor/react library updates the current model content when the value prop changes (via executeEdits), which may corrupt model A's content before setModel switches to model B. Runtime verification is needed to confirm tab content is preserved."
  - test: "Full editor flow: open file, edit, Ctrl+S, dirty dot, theme switch"
    expected: "File opens with syntax highlighting; dirty dot (●) appears after edit; Ctrl+S saves with toast '保存成功'; dot disappears; Monaco theme switches with app theme"
    why_human: "Visual and keyboard-interaction behaviors cannot be verified programmatically. CDN Monaco load, syntax highlighting, and toast rendering require browser execution."
---

# Phase 21: Code Editor Verification Report

**Phase Goal:** Users can view and edit any file in the worktree with a full-featured code editor
**Verified:** 2026-03-31
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Monaco packages installed | ✓ VERIFIED | `@monaco-editor/react@4.8.0-rc.3` and `monaco-editor@^0.55.1` in package.json lines 33, 41 |
| 2 | readFileContent server action reads file from worktree using safeResolvePath | ✓ VERIFIED | `src/actions/file-actions.ts` lines 150-157: zod validation, safeResolvePath, readFile call |
| 3 | writeFileContent server action writes to worktree file using safeResolvePath | ✓ VERIFIED | `src/actions/file-actions.ts` lines 166-174: zod validation, safeResolvePath, writeFile call |
| 4 | Editor i18n keys exist in both zh and en translation maps | ✓ VERIFIED | `grep -c "editor.saveSuccess" i18n.tsx` returns 2; all 6 keys confirmed in both locales |
| 5 | EditorTabs renders tab bar with dirty dot, close button, and active state | ✓ VERIFIED | `src/components/task/editor-tabs.tsx` 63 lines — dirty dot (● text-primary), X button with stopPropagation, border-primary active state |
| 6 | CodeEditor wraps Monaco with SSR-false dynamic import and CDN loader | ✓ VERIFIED | `src/components/task/code-editor.tsx` line 18-21: `dynamic(..., { ssr: false })`; line 13-15: `loader.config` with CDN URL |
| 7 | Ctrl+S invokes writeFileContent and shows toast | ✓ VERIFIED | `addAction` with `KeyMod.CtrlCmd | KeyCode.KeyS` at line 177; calls `writeFileContent` at line 185; `showToast("success")` at line 191 |
| 8 | Monaco theme follows resolvedTheme from useTheme() | ✓ VERIFIED | `useTheme()` at line 52; `monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "light"`; useEffect syncs on change at lines 81-87 |
| 9 | Files tab shows FileTree (left 240px) + CodeEditor (right flex-1) split | ✓ VERIFIED | `task-page-client.tsx` lines 333-360: `w-60 flex-none` left panel, `flex-1 min-w-0` right panel |
| 10 | selectedFilePath state bridges FileTree.onFileSelect to CodeEditor | ✓ VERIFIED | `useState<string|null>(null)` at line 70; passed as `selectedFilePath` prop to CodeEditor; `onFilePathChange={setSelectedFilePath}` |
| 11 | editor.noWorktree fallback when worktree is null | ✓ VERIFIED | Conditional at line 350: `latestExecution?.worktreePath ?` renders CodeEditor else fallback div with `t("editor.noWorktree")` |

**Score:** 11/11 automated truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | Monaco packages installed | ✓ VERIFIED | `@monaco-editor/react@4.8.0-rc.3`, `monaco-editor@^0.55.1` confirmed |
| `src/actions/file-actions.ts` | readFileContent + writeFileContent exports | ✓ VERIFIED | Both exported at lines 150 and 166; zod validated; safeResolvePath secured |
| `src/lib/i18n.tsx` | 6 editor.* keys in zh and en | ✓ VERIFIED | 12 total occurrences (6 keys × 2 locales); `editor.saveSuccess` count = 2 |
| `src/components/task/editor-tabs.tsx` | EditorTab interface + EditorTabs component | ✓ VERIFIED | 63 lines; exports `EditorTab`, `EditorTabsProps`, `EditorTabs`; dirty dot + close button substantive |
| `src/components/task/code-editor.tsx` | CodeEditor with full Monaco integration | ✓ VERIFIED | 292 lines; CDN loader, dynamic SSR-false, useTheme, addAction, readFileContent/writeFileContent, isDirty, toast — all present |
| `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` | Files tab with CodeEditor wired | ✓ VERIFIED | CodeEditor imported at line 13; used at line 351; split layout present; selectedFilePath bridge in place |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/actions/file-actions.ts` | `src/lib/fs-security.ts` | `safeResolvePath` import | ✓ WIRED | Imported at line 8; used at lines 155 and 172 in new actions |
| `src/components/task/code-editor.tsx` | `src/actions/file-actions.ts` | `readFileContent` + `writeFileContent` imports | ✓ WIRED | Line 8: `import { readFileContent, writeFileContent } from "@/actions/file-actions"` |
| `src/components/task/code-editor.tsx` | `next-themes` | `useTheme()` `resolvedTheme` | ✓ WIRED | Line 6: import; line 52: `const { resolvedTheme } = useTheme()` |
| `src/components/task/editor-tabs.tsx` | `src/components/task/code-editor.tsx` | `EditorTab` type consumed by CodeEditor | ✓ WIRED | Lines 9-10: `import { EditorTabs } from "./editor-tabs"` and `import type { EditorTab }` |
| `task-page-client.tsx FileTree.onFileSelect` | `CodeEditor.selectedFilePath` | `selectedFilePath` state | ✓ WIRED | `onFileSelect` sets `selectedFilePath` (line 344); `selectedFilePath` passed to CodeEditor (line 353) |
| `task-page-client.tsx` | `src/components/task/code-editor.tsx` | `import CodeEditor` + JSX render | ✓ WIRED | Import at line 13; rendered at line 351 (count = 3: import + comment + JSX) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `code-editor.tsx` | `tabs[].content` | `readFileContent(worktreePath, relativePath)` | Yes — calls `readFile(absolute, "utf-8")` from `fs/promises` with a real filesystem path | ✓ FLOWING |
| `code-editor.tsx` | `writeFileContent` save path | `writeFile(absolute, content, "utf-8")` | Yes — writes to resolved absolute path | ✓ FLOWING |
| `task-page-client.tsx` | `CodeEditor worktreePath` | `latestExecution.worktreePath` (from props, DB-sourced) | Yes — propagated from server-side execution record | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Monaco packages installed | `grep "@monaco-editor/react" package.json` | Found: `4.8.0-rc.3` | ✓ PASS |
| readFileContent exported | `grep "export async function readFileContent" src/actions/file-actions.ts` | Found at line 150 | ✓ PASS |
| writeFileContent exported | `grep "export async function writeFileContent" src/actions/file-actions.ts` | Found at line 166 | ✓ PASS |
| i18n saveSuccess key in both locales | `grep -c "editor.saveSuccess" src/lib/i18n.tsx` | Returns 2 | ✓ PASS |
| TypeScript compiles clean (phase 21 files) | `pnpm tsc --noEmit` filtered for phase 21 files | No errors | ✓ PASS |
| All 6 phase 21 commits exist | `git log --oneline` | 76ecfc2, 9174c86, 9f949f8, ffa62dc, 396c2e9, 1f2c8c1 — all found | ✓ PASS |
| SSR prevention | `grep "{ ssr: false }" code-editor.tsx` | Found at line 20 | ✓ PASS |
| CDN loader configured | `grep "loader.config" code-editor.tsx` | Found at lines 5 + 13 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| ED-01 | 21-01, 21-02, 21-03 | User can open a file in the workbench and view syntax-highlighted code (Monaco Editor) | ✓ SATISFIED | MonacoEditor component with LANG_MAP language detection; Files tab wired; CodeEditor reads file via readFileContent |
| ED-02 | 21-01, 21-02, 21-03 | User can save file to worktree disk via Ctrl+S | ✓ SATISFIED | `addAction` with `CtrlCmd+S`; calls `writeFileContent`; toast confirms save |
| ED-03 | 21-02, 21-03 | Editor shows unsaved file indicator (dirty dot) | ✓ SATISFIED | `isDirty` tracked in tab state; `●` rendered in EditorTabs when `tab.isDirty` is true |
| ED-04 | 21-02, 21-03 | User can open multiple file tabs and switch between them | ✓ SATISFIED (automated) — ? UNCERTAIN (runtime) | Tab state array, modelsRef Map, handleTabClick implemented. HOWEVER: uses `value` prop + `editor.setModel()` simultaneously — may cause content corruption on switch. Needs human verification. |
| ED-05 | 21-02, 21-03 | Editor theme follows ai-manager dark/light setting | ✓ SATISFIED | `useTheme()` resolvedTheme; `vs-dark` / `light` mapping; useEffect calls `monaco.editor.setTheme` on change |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/actions/file-actions.ts` | 82 | `return {}` | ℹ️ Info | Pre-existing error fallback in `getGitStatus` (not phase 21 code); empty object is correct for "no git changes" error case |
| `src/components/task/editor-tabs.tsx` | 24 | `return null` | ℹ️ Info | Intentional empty-tabs state (not a stub) — CodeEditor shows its own empty placeholder when tabs.length === 0 |
| `src/components/task/code-editor.tsx` | 125-127 | Silent catch: `// Silently fail — file may not be readable` | ⚠️ Warning | File read errors are swallowed — user gets no feedback if readFileContent fails (e.g. binary file, permissions error). Not a blocker but degrades UX. |

### Human Verification Required

#### 1. Multi-Tab Content Preservation (ED-04)

**Test:** Open file A, type some characters (do NOT save). Click file B in the FileTree. Click back on tab A.
**Expected:** Tab A should show your original unsaved edits intact.
**Why human:** The implementation uses `value={activeTab?.content}` prop on MonacoEditor simultaneously with `editor.setModel()` in a useEffect. The `@monaco-editor/react` library responds to `value` prop changes by calling `editor.executeEdits()` on the currently active model. When tab A → B, the `value` prop changes to B's content, which may overwrite A's Monaco model content before `setModel` switches to B's model. The tabs state array preserves A's content in React, but the Monaco model for A might be corrupted. The round-trip back to A would then re-apply A's content via `value` prop — but the dirty state and undo stack could be lost. Needs browser verification to confirm acceptable behavior.

**Recommended fix if failing:** Replace `value={activeTab?.content ?? ""}` with the `path` prop pattern recommended by @monaco-editor/react for multi-model editing. Use `path={activeTabPath ?? undefined}` and `defaultValue` for initial content — the library then manages model switching internally without content conflicts.

#### 2. Full Editor Flow Verification

**Test:**
1. Start `pnpm dev`
2. Navigate to a task that has an active execution with a worktree
3. Open the task workbench
4. Click the "文件" (Files) tab
5. Confirm: FileTree visible left (~240px), editor area on the right
6. Click a `.ts` or `.md` file in the tree
7. Confirm: file opens in Monaco with colored syntax highlighting
8. Edit the file content — type a few characters
9. Confirm: dirty dot (●) appears before the filename in the tab
10. Press Ctrl+S (Cmd+S on Mac)
11. Confirm: toast "保存成功" / "File saved" appears bottom-right, dirty dot disappears
12. Toggle dark/light mode in ai-manager settings
13. Confirm: Monaco editor background switches (dark = dark background, light = white)
14. Click the X button on a tab to close it
15. Confirm: tab closes, remaining tabs or empty state shown

**Expected:** All 15 steps pass.
**Why human:** Visual rendering (Monaco load, syntax colors, toast position), keyboard shortcuts, theme switching, and CDN resource loading all require browser execution.

### Gaps Summary

No hard gaps found. All five ED requirements have implementation evidence in the codebase. Two items require human browser verification:

1. **ED-04 runtime correctness** — The dual `value` prop + `editor.setModel()` pattern in `code-editor.tsx` is non-idiomatic for @monaco-editor/react multi-model editing and may corrupt model content during tab switches. The `path` prop approach is the library-recommended pattern. This does not block the phase from passing if browser testing confirms the current implementation works acceptably, but a refactor to the `path` prop pattern would be more robust.

2. **Full visual flow** — Monaco editor initialization, CDN loading, and keyboard shortcuts cannot be verified without running the app.

---

_Verified: 2026-03-31_
_Verifier: Claude (gsd-verifier)_
