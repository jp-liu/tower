# Detail Page — VSCode-like Git UX & Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Milestone:** v1.3 (provisional — relabel if user prefers a different version tag)
**Date:** 2026-05-11
**Module(s):** `task`, `git`, `i18n`

**Goal:** Bring the task detail page's code-viewing and Git workflow to VSCode-grade reliability and completeness — without dragging in the full VSCode runtime — by (a) fixing three known reliability bugs, (b) replacing the inline diff renderer with a virtualized library that won't crash on large diffs, (c) adding hunk-level stage / discard, (d) wiring Monaco gutter change decorations, and (e) optionally adding file history + blame.

**Architecture:** Keep the existing stack — Monaco editor + the custom React `EditorGitPanel` + `simple-git` backend via `/api/git` — and fill specific gaps with two targeted libraries (`@git-diff-view/react` for the diff surface, `parse-diff` for hunk introspection on the server). Server-side: extend `POST /api/git` with `diff-file`, `stage-hunk`, `discard-hunk`, `log-file`, `blame` actions, and CRLF-normalize all text returned by `show` / `diff`. Client-side: (1) gate the Monaco model-mount effect on `monacoReady` state so the first file gets highlighted, (2) normalize CRLF before feeding `DiffEditor` so Windows shows highlights, (3) replace the unvirtualized `<pre>`-with-spans patch renderer in `TaskDiffView` with a virtualized component, (4) drive `editor.deltaDecorations` from a per-file diff hunk fetch.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Monaco 0.55 (`@monaco-editor/react` 4.8) · `simple-git` 3.36 (already installed) · `@git-diff-view/react` (new) · `parse-diff` (new) · Vitest + RTL · `sonner` · Tailwind 4 · shadcn / base-nova.

---

## Scope Note (per writing-plans guidance)

This plan covers **5 phases** that can ship independently. Each phase ends in a working, testable state. If the spec is too large to execute as one plan, split as follows:

| Phase | Scope | Estimate | Depends on | Standalone? |
|-------|-------|----------|-----------|-------------|
| 1 | 3 bug fixes (Monaco mount, CRLF, diff-view crash) | 0.5–1 day | — | ✅ |
| 2 | Replace inline diff renderer with virtualized library | 1.5 days | Phase 1 (CRLF normalize) | mostly |
| 3 | Hunk-level stage / discard (server + UI) | 1 day | Phase 2 (uses its hunk UI) | no |
| 4 | Monaco gutter change decorations | 0.5 day | — | ✅ |
| 5 | File history + blame panel (optional) | 1.5 days | — | ✅ |

**Recommended execution order:** P1 → P4 (independent, quick wins) → P2 → P3 → P5.
**Minimum shippable for v1.3:** P1 + P2 + P3 (≈3.5 days of work).

---

## Files Created / Modified

**Created**

- `src/lib/git-diff.ts` — `parse-diff` wrapper: `parseUnifiedDiff(patch)`, `hunkToPatch(hunk)`, `indexHunksByFile(...)`. Plus CRLF normalization helper exported once for reuse.
- `src/lib/__tests__/git-diff.test.ts`
- `src/components/task/diff-view.tsx` — new `@git-diff-view/react`-backed unified diff component. Replaces the `<pre>`-with-spans body inside `TaskDiffView` for non-binary files. Exposes hunk-level `onStage` / `onDiscard` callbacks (used by Phase 3).
- `src/components/task/__tests__/diff-view.test.tsx`
- `src/lib/monaco-gutter.ts` — `applyGutterDecorations(editor, monaco, hunks)`: maps unified-diff hunks to Monaco line decorations (`line-added`, `line-modified`, `line-deleted`). Idempotent — tracks previous decoration IDs.
- `src/lib/__tests__/monaco-gutter.test.ts`
- `src/components/task/__tests__/code-editor.test.tsx`
- `src/components/task/__tests__/diff-editor.test.tsx`
- `src/components/task/__tests__/task-diff-view.test.tsx`
- `src/components/task/file-history-panel.tsx` (P5) — git log for the active file, opens commit detail
- `src/components/task/blame-overlay.tsx` (P5) — per-line blame strip pinned to the left of Monaco

**Modified**

- `src/app/api/git/route.ts` — (a) CRLF-normalize `show` output, (b) add 5 new POST actions: `diff-file` (returns unified patch for one file vs HEAD/index), `stage-hunk` (apply patch with `git apply --cached`), `discard-hunk` (apply reverse patch with `git apply -R`), `log-file` (commits touching a path), `blame` (porcelain output parsed)
- `src/components/task/code-editor.tsx` — fix Monaco model-mount race (Task 1); add `useEditorGutter` hook call wiring decorations (Task 12)
- `src/components/task/diff-editor.tsx` — CRLF-normalize both contents before Monaco mount (Task 2)
- `src/components/task/task-diff-view.tsx` — render via new `DiffView` for non-binary files; keep summary header & expand/collapse (Task 5); pass through hunk-level callbacks (Task 8)
- `src/components/task/editor-git-panel.tsx` — file row gets a `…` menu with "Stage hunk…" / "Discard hunk…" entries that open a `DiffView` dialog with per-hunk buttons (Task 9)
- `src/lib/i18n/zh.ts` and `src/lib/i18n/en.ts` — keys for hunk operations, patch truncation, history, blame
- `src/globals.css` (or wherever editor CSS lives) — `.line-added`, `.line-modified`, `.line-deleted` gutter classes

**Untouched (deliberately)**

- `src/lib/git-api.ts` — already a thin client wrapper, no need to change
- `src/components/task/diff-editor.tsx` Monaco config beyond line-ending normalization
- File tree, search, terminal, preview, notes — all out of scope
- `simple-file-viewer.tsx` (the no-Monaco fallback from Phase 71) — keep as-is

---

## Test Strategy

- **Unit:** `git-diff.ts` parsing + hunk → patch round-trips on real fixture patches; `monaco-gutter.ts` decoration synthesis given hunk inputs
- **Component (RTL):** `DiffView` renders unified diff, expands/collapses hunks, handles binary files, emits stage/discard callbacks; `EditorGitPanel` opens the hunk-action menu; `CodeEditor` creates Monaco model on first mount (regression for Task 1)
- **Integration:** `/api/git` `diff-file`, `stage-hunk`, `discard-hunk` exercised against a temp `git init` repo (use `tmp` package or `os.tmpdir()`)
- **Manual smoke (must pass before phase commits):** macOS + Windows — first file highlights, diff view doesn't crash on a 5k-line patch, side-by-side diff shows +/- highlights, gutter shows green/blue bars while editing

---

## Phase 1: Critical Bug Fixes

Three small independent fixes. Goal: ship-blocker bugs gone, end-of-phase commit gives a clean working state even if Phase 2+ slip.

### Task 1: First-tab no syntax highlight

**Symptom:** Open the detail page, click any file — Monaco renders content but no syntax colors. Click a second file → first file now highlighted. Editing the first file also "wakes up" highlight.

**Root cause:** The model-creation effect in `code-editor.tsx:270-302` reads `editorRef.current` and `monacoRef.current` synchronously. On the very first render, these refs are still `null` because `handleEditorMount` only runs after Monaco has loaded. The effect bails out (`if (!editor || !monaco || !activeTabPath) return;`). Subsequent re-renders that include `monacoRef.current` don't re-run the effect because its deps (`[activeTabPath, tabs]`) haven't changed. When the user clicks a second file, `activeTabPath` changes and the effect fires with everything in place — highlighting the second file and (as a side effect) the first one too once `setModel` is called.

**Fix:** Add `monacoReady` state, flip it in `handleEditorMount`, include it in the effect deps. Forces a re-run once Monaco has actually mounted.

**Files:**
- Modify: `src/components/task/code-editor.tsx` — add state, add `setMonacoReady(true)` at end of `handleEditorMount`, add `monacoReady` to effect deps
- Create: `src/components/task/__tests__/code-editor.test.tsx`

- [ ] **Step 1: Write failing regression test**

  Create `src/components/task/__tests__/code-editor.test.tsx`. Mock `@monaco-editor/react` so that `default` (the Editor component) calls `onMount(fakeEditor, fakeMonaco)` synchronously on mount, where `fakeMonaco` exposes a spy `createModel` and `setModel` on `fakeEditor`. Mock `readFileContent` to resolve with `{ kind: "text", content: "console.log('a');" }`.

  Render `<CodeEditor worktreePath="/x" selectedFilePath="/x/a.ts" />`. After `waitFor`, assert `fakeMonaco.editor.createModel` was called exactly once with `"console.log('a');"`, the language string `"typescript"`, and a `Uri` whose `.toString()` ends with `a.ts`. Assert `fakeEditor.setModel` was called with the returned model.

- [ ] **Step 2: Run — verify FAIL**

  ```bash
  pnpm test src/components/task/__tests__/code-editor.test.tsx -- --run
  ```

  Expected: assertion failure on `createModel.toHaveBeenCalled()` (effect bailed before refs were ready).

- [ ] **Step 3: Add `monacoReady` state**

  In `src/components/task/code-editor.tsx`, near the other `useState`s:

  ```typescript
  const [monacoReady, setMonacoReady] = useState(false);
  ```

  At the end of `handleEditorMount`:

  ```typescript
  setMonacoReady(true);
  ```

  In the model-creation `useEffect`, change deps from `[activeTabPath, tabs]` to `[activeTabPath, tabs, monacoReady]`.

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Manual smoke**

  ```bash
  pnpm dev
  ```

  Open task detail with worktree → click any file → confirm syntax highlight appears immediately.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/task/code-editor.tsx src/components/task/__tests__/code-editor.test.tsx
  git commit -m "fix(task): first-opened file now gets syntax highlight on mount"
  ```

### Task 2: Windows DiffEditor shows no highlights

**Symptom:** On Windows, the side-by-side diff opens but neither side shows +/- inline highlights. The same file on macOS / Linux shows highlights normally.

**Root cause:** `originalContent` comes from `git show HEAD:path` which always returns LF endings. `modifiedContent` comes from `readFileContent` → `fs.readFile`, which on Windows-checked-out files contains CRLF. Monaco's `DiffEditor` runs Myers diff on the raw strings, so every line is reported as changed (`\r` differs). Monaco's renderer then either over-highlights (paints every line) or — depending on its `eol` normalization heuristic — collapses to "no changes" and renders nothing.

**Fix:** Normalize both inputs to LF before passing to Monaco. Also normalize on the server in the `show` action, as defense in depth.

**Files:**
- Modify: `src/components/task/diff-editor.tsx`
- Modify: `src/app/api/git/route.ts` (in `case "show"`)
- Create: `src/components/task/__tests__/diff-editor.test.tsx`

- [ ] **Step 1: Write failing component test**

  Mock `@monaco-editor/react`'s `DiffEditor` as a recording stub: `({ original, modified }) => { capturedRef.current = { original, modified }; return null; }`. Render `<DiffEditorView originalContent={"a\r\nb\r\n"} modifiedContent={"a\nb\nc\n"} filePath="x.ts" />`. Assert `capturedRef.current` equals `{ original: "a\nb\n", modified: "a\nb\nc\n" }`.

- [ ] **Step 2: Run — verify FAIL**

  ```bash
  pnpm test src/components/task/__tests__/diff-editor.test.tsx -- --run
  ```

- [ ] **Step 3: Add normalization helper**

  Add `src/lib/git-diff.ts` with the single export (the rest of the file is built up in Phase 2):

  ```typescript
  export function normalizeLF(s: string): string {
    return s.replace(/\r\n/g, "\n");
  }
  ```

  In `src/components/task/diff-editor.tsx`, import `normalizeLF` and wrap both content props:

  ```typescript
  import { normalizeLF } from "@/lib/git-diff";
  // ...
  <MonacoDiffEditor
    // ...
    original={normalizeLF(originalContent)}
    modified={normalizeLF(modifiedContent)}
  ```

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Server-side defense in depth**

  In `src/app/api/git/route.ts`, `case "show"` (line ~325):

  ```typescript
  const content = await git.show(`${safeRef}:${safeFile}`);
  return NextResponse.json({ success: true, content: content.replace(/\r\n/g, "\n") });
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/git-diff.ts src/components/task/diff-editor.tsx src/components/task/__tests__/diff-editor.test.tsx src/app/api/git/route.ts
  git commit -m "fix(task): normalize CRLF before diff comparison (Windows highlights)"
  ```

### Task 3: Diff view crashes on large patches

**Symptom:** Clicking the "Changes" tab on a task with many modified files, then expanding one with a big patch, freezes / crashes the page.

**Root cause:** `task-diff-view.tsx:139-159` renders the full patch via `patch.split("\n").map((line, idx) => <span key={idx} ...>{line}</span>)`. A 10k-line patch creates 10k React nodes synchronously inside a `<pre>`. Multiple expanded files compound the cost.

**Fix for Phase 1 (minimal — full replacement is Phase 2):** Cap inline rendering at 500 lines. Show a "Patch too large, open in side-by-side view" link below. This guarantees no crash even before Phase 2 lands.

**Files:**
- Modify: `src/components/task/task-diff-view.tsx`
- Modify: `src/lib/i18n/zh.ts`, `src/lib/i18n/en.ts`
- Create: `src/components/task/__tests__/task-diff-view.test.tsx`

- [ ] **Step 1: Add i18n keys**

  In `zh.ts`:
  ```typescript
  "diff.patchTruncated": "差异内容过大，已截断显示前 {n} 行（共 {total} 行）",
  "diff.openInDiffView": "在并排视图中打开",
  ```

  In `en.ts`:
  ```typescript
  "diff.patchTruncated": "Patch too large — showing first {n} of {total} lines",
  "diff.openInDiffView": "Open in side-by-side view",
  ```

- [ ] **Step 2: Write failing test**

  Build a 1000-line synthetic patch; render `TaskDiffView` with one file containing it; click the file header to expand; assert (a) at most 500 line `<span>`s are rendered (`screen.queryAllByText(/^[+\-@ ]/).length ≤ 500`), (b) the truncation notice with `"1000"` total is visible.

- [ ] **Step 3: Run — verify FAIL**

- [ ] **Step 4: Implement truncation**

  In `task-diff-view.tsx`, replace lines 142-157 with:

  ```typescript
  const TRUNCATE_AT = 500;
  const allLines = file.patch.split("\n");
  const displayLines = allLines.slice(0, TRUNCATE_AT);
  const truncated = allLines.length > TRUNCATE_AT;

  return (
    <>
      <pre className="overflow-x-auto p-0 text-xs font-mono leading-5">
        {displayLines.map((line, idx) => {
          const lineClass =
            line.startsWith("+") && !line.startsWith("+++")
              ? "px-4 block bg-green-500/10 text-green-400"
              : line.startsWith("-") && !line.startsWith("---")
              ? "px-4 block bg-red-500/10 text-red-400"
              : line.startsWith("@@")
              ? "px-4 block bg-blue-500/10 text-blue-300"
              : "px-4 block text-muted-foreground";
          return <span key={idx} className={lineClass}>{line || " "}</span>;
        })}
      </pre>
      {truncated && (
        <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
          {t("diff.patchTruncated", { n: String(TRUNCATE_AT), total: String(allLines.length) })}
        </div>
      )}
    </>
  );
  ```

- [ ] **Step 5: Run — verify PASS**

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/task/task-diff-view.tsx src/components/task/__tests__/task-diff-view.test.tsx src/lib/i18n/zh.ts src/lib/i18n/en.ts
  git commit -m "fix(task): cap inline patch rendering at 500 lines to prevent crash"
  ```

### Phase 1 Checkpoint

- [ ] **Run all tests:** `pnpm test:run`
- [ ] **Manual cross-platform smoke:** open detail page on macOS and (if available) Windows — verify the 3 bugs are gone.
- [ ] **Empty marker commit:** `git commit --allow-empty -m "chore(phase1): detail-page reliability fixes complete"`

---

## Phase 2: Virtualized Diff Viewer

Goal: replace the unvirtualized inline-patch renderer with `@git-diff-view/react`, which (a) virtualizes long diffs (no crashes), (b) gives syntax-highlighted, hunk-aware rendering, (c) exposes per-hunk click handlers we'll use in Phase 3.

### Task 4: Install + scaffold `git-diff.ts`

**Files:**
- Modify: `package.json` (add deps)
- Modify: `src/lib/git-diff.ts` (extend the file created in Task 2)
- Modify: `src/lib/__tests__/git-diff.test.ts` (create)

- [ ] **Step 1: Install dependencies**

  ```bash
  pnpm add @git-diff-view/react parse-diff
  ```

  `parse-diff` ships its own types as of v0.11 — no `@types/parse-diff` needed (pnpm will warn if you try). Confirm `package.json` lists both under `dependencies` and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Write failing test**

  In `src/lib/__tests__/git-diff.test.ts`:

  ```typescript
  import { parseUnifiedDiff, hunkToPatch } from "../git-diff";

  describe("parseUnifiedDiff", () => {
    it("returns one file with hunks for a simple modify", () => {
      const patch = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,2 +1,2 @@
-a
+b
 c
`;
      const files = parseUnifiedDiff(patch);
      expect(files).toHaveLength(1);
      expect(files[0].to).toBe("x.ts");
      expect(files[0].chunks).toHaveLength(1);
    });
  });

  describe("hunkToPatch", () => {
    it("rebuilds a valid single-hunk patch for `git apply`", () => {
      const files = parseUnifiedDiff(/* fixture */);
      const patch = hunkToPatch(files[0], files[0].chunks[0]);
      expect(patch).toMatch(/^diff --git/);
      expect(patch).toMatch(/@@ -1,2 \+1,2 @@/);
    });
  });
  ```

- [ ] **Step 3: Run — verify FAIL**

  ```bash
  pnpm test src/lib/__tests__/git-diff.test.ts -- --run
  ```

- [ ] **Step 4: Implement**

  Extend `src/lib/git-diff.ts`:

  ```typescript
  import parseDiff from "parse-diff";
  import type { File, Chunk } from "parse-diff";

  export { normalizeLF };
  export type DiffFile = File;
  export type DiffChunk = Chunk;

  export function parseUnifiedDiff(patch: string): DiffFile[] {
    return parseDiff(normalizeLF(patch));
  }

  export function hunkToPatch(file: DiffFile, hunk: DiffChunk): string {
    const header = [
      `diff --git a/${file.from ?? file.to} b/${file.to ?? file.from}`,
      `--- a/${file.from ?? file.to}`,
      `+++ b/${file.to ?? file.from}`,
    ].join("\n");
    const body = [
      hunk.content,
      ...hunk.changes.map((c) =>
        c.type === "add" ? `+${c.content.slice(1)}`
        : c.type === "del" ? `-${c.content.slice(1)}`
        : ` ${c.content.slice(1)}`
      ),
    ].join("\n");
    return `${header}\n${body}\n`;
  }
  ```

- [ ] **Step 5: Run — verify PASS**

- [ ] **Step 6: Commit**

  ```bash
  git add package.json pnpm-lock.yaml src/lib/git-diff.ts src/lib/__tests__/git-diff.test.ts
  git commit -m "feat(git): add parse-diff wrapper + @git-diff-view/react dependency"
  ```

### Task 5: New `DiffView` component

**Files:**
- Create: `src/components/task/diff-view.tsx`
- Create: `src/components/task/__tests__/diff-view.test.tsx`

`DiffView` is a single-file unified-diff renderer. Inputs: `patch` string (raw unified diff for one file), `language` (for syntax highlighting), optional `onStageHunk` / `onDiscardHunk` callbacks (Phase 3).

- [ ] **Step 1: Read `@git-diff-view/react` quickstart**

  ```bash
  cat node_modules/@git-diff-view/react/README.md | head -100
  ```

  Skim the component name, prop shape, and supported themes. (Library version pinned in Task 4.)

- [ ] **Step 2: Write failing test**

  In `src/components/task/__tests__/diff-view.test.tsx`: render `<DiffView patch={fixture} language="typescript" />` with a fixture patch that has 2 hunks. Assert: at least one element with `data-testid="diff-hunk"` appears (or whatever the library's marker is — verify against README in Step 1). With `onStageHunk` provided, "Stage hunk" buttons exist; click one and assert the callback fires with the right hunk index.

- [ ] **Step 3: Run — verify FAIL**

- [ ] **Step 4: Implement `DiffView`**

  Wire `parseUnifiedDiff(patch)` → loop over chunks → render via `@git-diff-view/react`'s component (likely `DiffView` or `DiffFile`) with `data` prop. Above each hunk render a small toolbar with optional `Stage` / `Discard` buttons that call back with the hunk content. Use Tailwind classes consistent with `ui.md` (h-8 buttons, ghost variant).

- [ ] **Step 5: Run — verify PASS**

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/task/diff-view.tsx src/components/task/__tests__/diff-view.test.tsx
  git commit -m "feat(task): DiffView component using @git-diff-view/react"
  ```

### Task 6: Swap `TaskDiffView` body to use `DiffView`

**Files:**
- Modify: `src/components/task/task-diff-view.tsx`
- Modify: `src/components/task/__tests__/task-diff-view.test.tsx`

Keep `TaskDiffView`'s outer layout (header bar with totals, conflict warning, file header rows with expand/collapse, commit dialog). Inside each expanded file's body, replace the inline `<pre>`+spans block (the truncation logic from Task 3) with `<DiffView patch={file.patch} language={detectLanguage(file.filename)} />`.

The truncation from Task 3 can stay as a hard cap inside `DiffView` (defense), but the library should handle virtualization. Verify by rendering a fixture with 10k lines and checking that `screen.queryAllByText(/^[+\-]/)` returns < 1000 (only what's in the viewport).

- [ ] **Step 1: Update test**

  Adjust the Task-3 test to assert via `DiffView`'s rendering instead of the old span count. Add an extra case: 10k-line patch renders without throwing and finishes within 500ms (`performance.now()` bracket).

- [ ] **Step 2: Run — verify FAIL** (old span-counting assertion will fail because spans are now inside the library)

- [ ] **Step 3: Swap implementation**

  ```typescript
  // task-diff-view.tsx — replace the inline <pre> + truncation block:
  {isExpanded && file.patch && !file.isBinary && (
    <div className="border-t border-border bg-background">
      <DiffView patch={file.patch} language={detectLanguage(file.filename)} />
    </div>
  )}
  ```

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Manual smoke**

  ```bash
  pnpm dev
  ```

  Open a task with a known-large diff. Confirm scrolling is smooth, no crash. Switch between files repeatedly — no memory leak.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/task/task-diff-view.tsx src/components/task/__tests__/task-diff-view.test.tsx
  git commit -m "feat(task): virtualize diff rendering via @git-diff-view/react"
  ```

### Phase 2 Checkpoint

- [ ] **Run all tests:** `pnpm test:run`
- [ ] **Empty marker commit:** `git commit --allow-empty -m "chore(phase2): virtualized diff viewer landed"`

---

## Phase 3: Hunk-level Stage / Discard

Goal: VSCode parity for the most-requested operation — staging or discarding a single hunk instead of the whole file.

### Task 7: Server-side `diff-file` / `stage-hunk` / `discard-hunk`

**Files:**
- Modify: `src/app/api/git/route.ts`
- Create: `src/app/api/git/__tests__/route.test.ts` (or `tests/api/git.test.ts` per project convention — check existing test layout first)

Three new POST actions:

- `diff-file` — body `{ action: "diff-file", path, file, staged?: boolean }` → returns `{ patch: string }`. Use `git.diff([staged ? "--cached" : "--", "--", file])` via `simple-git`.
- `stage-hunk` — body `{ action: "stage-hunk", path, patch }` → write `patch` to a temp file, run `git apply --cached <tmpfile>`, delete tmp. Return `{ success: true }`.
- `discard-hunk` — body `{ action: "discard-hunk", path, patch }` → write `patch` to a temp file, run `git apply -R <tmpfile>` (reverse apply on working tree). Return `{ success: true }`.

Tmp files: `os.tmpdir()/tower-git-{random}.patch`, mode 0600, always `fs.unlink` in `finally`.

**Path normalization note (CRITICAL):** `simple-git`'s `git.raw([...])` runs with the repo root (`path` from the body) as CWD. The `a/...` and `b/...` paths inside the patch produced by `hunkToPatch` MUST be relative to that repo root. `parse-diff` (Phase 2) reports paths exactly as they appear in the unified diff. Since `diff-file` runs `git.diff(...)` from the repo root, the paths are already correct. **But** if a caller hand-builds a patch from a sub-directory `git diff`, paths will be wrong and `git apply` will silently say "no such file." Always source patches from the `diff-file` endpoint to avoid this trap.

- [ ] **Step 1: Write failing integration test**

  Spin up a temp git repo (`os.tmpdir()` + `fs.mkdtempSync`), write a file, `git init && git add && git commit`, modify the file with 2 distinct hunks. POST `diff-file` → assert returned patch has both `@@` markers. Parse it, take only the first hunk, POST `stage-hunk` with that patch. Then `git diff --cached` and assert only the first hunk's changes are staged.

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement the three cases**

  In the `switch (action)` block:

  ```typescript
  case "diff-file": {
    const safeFile = sanitizeFilePath(body.file);
    const staged = Boolean(body.staged);
    const patch = staged
      ? await git.diff(["--cached", "--", safeFile])
      : await git.diff(["--", safeFile]);
    return NextResponse.json({ patch: patch.replace(/\r\n/g, "\n") });
  }

  case "stage-hunk":
  case "discard-hunk": {
    const patch = body.patch;
    if (typeof patch !== "string" || !patch.includes("@@")) {
      return NextResponse.json({ error: "invalid patch" }, { status: 400 });
    }
    const tmpPath = path.join(os.tmpdir(), `tower-git-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`);
    fs.writeFileSync(tmpPath, patch, { mode: 0o600 });
    try {
      if (action === "stage-hunk") {
        await git.raw(["apply", "--cached", tmpPath]);
      } else {
        await git.raw(["apply", "-R", tmpPath]);
      }
      return NextResponse.json({ success: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message || "apply failed" }, { status: 500 });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
  ```

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/api/git/route.ts src/app/api/git/__tests__/route.test.ts
  git commit -m "feat(api/git): diff-file, stage-hunk, discard-hunk endpoints"
  ```

### Task 8: Wire hunk callbacks through `DiffView` → `TaskDiffView`

**Files:**
- Modify: `src/components/task/diff-view.tsx` (already accepts callbacks from Task 5)
- Modify: `src/components/task/task-diff-view.tsx`

`TaskDiffView` doesn't directly need hunk operations (it's for completed-task diff review). But `DiffView` should already support the callbacks. Leave a TODO comment if `TaskDiffView` shouldn't expose them yet — they'll be wired in `EditorGitPanel` in Task 9.

- [ ] **Step 1: Verify Task-5 callback flow with a manual trace** (no test needed if covered by Task-5 spec). Skip if `DiffView` test already exercises `onStageHunk` / `onDiscardHunk`.

- [ ] **Step 2: Commit** (likely empty)

  ```bash
  git commit --allow-empty -m "chore(task): confirm DiffView hunk callbacks from Phase 2 cover Phase 3 needs"
  ```

### Task 9: Hunk menu in `EditorGitPanel`

**Files:**
- Modify: `src/components/task/editor-git-panel.tsx`
- Modify: `src/lib/i18n/zh.ts`, `src/lib/i18n/en.ts`
- Modify: `src/components/task/__tests__/editor-git-panel.test.tsx` (create if absent)

In the `TreeRow` for unstaged files: add a third hover-action button (next to `+` and trash icon) that opens a Dialog containing `<DiffView patch={...} onStageHunk={...} onDiscardHunk={...} />` for that file. Patch comes from `gitAction(localPath, "diff-file", { file, staged: false })`.

For staged files: same dialog, but the `+` becomes `-` (unstage hunk = stage-hunk-reverse semantics, but simpler: just refetch with `staged: true` and offer "Unstage hunk" only).

i18n keys:

```typescript
// zh
"git.stageHunk": "暂存此 hunk",
"git.discardHunk": "丢弃此 hunk",
"git.unstageHunk": "取消暂存此 hunk",
"git.viewHunks": "查看 / 操作 hunk",
"git.hunkApplyFailed": "应用 hunk 失败 — 文件可能已更改",
// en
"git.stageHunk": "Stage hunk",
"git.discardHunk": "Discard hunk",
"git.unstageHunk": "Unstage hunk",
"git.viewHunks": "View / stage hunks",
"git.hunkApplyFailed": "Hunk apply failed — file may have changed",
```

- [ ] **Step 1: Add i18n keys**

- [ ] **Step 2: Write failing test**

  In `editor-git-panel.test.tsx`: render `EditorGitPanel` with mocked `gitAction` returning a 2-hunk patch. Click the new hunk-menu icon on an unstaged file row → dialog opens → both hunks are visible → click "Stage hunk" on hunk 1 → assert `gitAction` called with `("stage-hunk", { patch: <hunk-1-patch> })`. After success: dialog closes (or refreshes content), file list refreshes.

- [ ] **Step 3: Run — verify FAIL**

- [ ] **Step 4: Implement**

  Add state: `const [hunkDialog, setHunkDialog] = useState<{ file: string; staged: boolean } | null>(null)`. Add icon `Layers` from lucide-react in the file row hover toolbar. Open dialog → fetch patch → render `DiffView`. Inside dialog: on `onStageHunk(patch)` call `gitAction(localPath, "stage-hunk", { patch })`, refresh, toast on success/failure.

- [ ] **Step 5: Run — verify PASS**

- [ ] **Step 6: Manual smoke**

  Modify two non-adjacent regions of a file in a real workspace → open detail → click the new hunk icon → stage one hunk → confirm `git status` shows the file in both staged AND unstaged.

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/task/editor-git-panel.tsx src/lib/i18n/zh.ts src/lib/i18n/en.ts src/components/task/__tests__/editor-git-panel.test.tsx
  git commit -m "feat(task): hunk-level stage / discard / unstage in git panel"
  ```

### Phase 3 Checkpoint

- [ ] **Run all tests:** `pnpm test:run`
- [ ] **Empty marker commit:** `git commit --allow-empty -m "chore(phase3): hunk-level git operations complete"`

---

## Phase 4: Monaco Gutter Decorations

Goal: when editing a tracked file, show VSCode-style gutter bars: green for added lines, blue for modified lines, a small wedge for deleted line markers.

### Task 10: `monaco-gutter.ts` library

**Files:**
- Create: `src/lib/monaco-gutter.ts`
- Create: `src/lib/__tests__/monaco-gutter.test.ts`
- Modify: `src/app/globals.css` (or wherever the editor styles live — find with `grep -r "vs-dark" src/`)

Helper: given a Monaco editor instance + parsed hunks (from `parse-diff`), apply `editor.deltaDecorations` to add `linesDecorationsClassName: "line-added" | "line-modified"`. Track previous decoration IDs so calls are idempotent.

- [ ] **Step 1: Write failing test**

  Mock a Monaco `editor` with `deltaDecorations: jest.fn((old, next) => next.map((_, i) => `id-${i}`))`. Call `applyGutterDecorations(editor, monaco, hunks)` with a fixture hunk set. Assert: returned IDs are stored on next call; second call passes those IDs as `oldIds`.

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement**

  ```typescript
  type MonacoEditor = { deltaDecorations: (old: string[], next: unknown[]) => string[] };
  type MonacoRange = new (sl: number, sc: number, el: number, ec: number) => unknown;
  type MonacoApi = { Range: MonacoRange };

  const decorationsByEditor = new WeakMap<MonacoEditor, string[]>();

  export function applyGutterDecorations(
    editor: MonacoEditor,
    monaco: MonacoApi,
    hunks: Array<{ newStart: number; newLines: number; kind: "add" | "modify" | "delete" }>,
  ) {
    const next = hunks.map((h) => ({
      range: new monaco.Range(h.newStart, 1, h.newStart + Math.max(h.newLines, 1) - 1, 1),
      options: { linesDecorationsClassName: `line-${h.kind}` },
    }));
    const old = decorationsByEditor.get(editor) ?? [];
    const ids = editor.deltaDecorations(old, next);
    decorationsByEditor.set(editor, ids);
    return ids;
  }
  ```

  In `globals.css`:

  ```css
  .line-added { background: rgba(74, 222, 128, 0.6); width: 3px !important; margin-left: 2px; }
  .line-modified { background: rgba(96, 165, 250, 0.6); width: 3px !important; margin-left: 2px; }
  .line-delete { background: rgba(248, 113, 113, 0.6); width: 3px !important; margin-left: 2px; height: 6px; margin-top: -3px; }
  ```

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/monaco-gutter.ts src/lib/__tests__/monaco-gutter.test.ts src/app/globals.css
  git commit -m "feat(editor): gutter decoration helper + line-added/modified/delete CSS"
  ```

### Task 11: Wire decorations into `CodeEditor`

**Files:**
- Modify: `src/components/task/code-editor.tsx`

Inside `CodeEditor`, after Monaco mounts and a file is active, fetch `gitAction(worktreePath, "diff-file", { file: activeTab.relativePath })`. Parse the patch (`parseUnifiedDiff` from Phase 2). Map chunks to `{ newStart, newLines, kind }`. Call `applyGutterDecorations`. Refetch when active tab changes, or when the file is saved (we know `isDirty → false` triggers a save).

Use a debounced effect (300ms) on `[activeTabPath, tab.isDirty]` to avoid hammering the server on every keystroke.

- [ ] **Step 1: Write test** (RTL — mock `gitAction` + Monaco; assert decoration helper called on tab change with parsed hunks)

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Add the effect**

  Add a `gutterTick` counter — this is the explicit signal that triggers re-fetch after a save. **Do NOT** include `tab.isDirty` in the effect deps: typing must not pound the server, only successful saves should refresh decorations.

  ```typescript
  const [gutterTick, setGutterTick] = useState(0);

  // Inside saveActiveTab, after writeFileContent succeeds:
  setGutterTick((t) => t + 1);

  useEffect(() => {
    if (!monacoReady || !activeTab) return;
    const handle = setTimeout(async () => {
      try {
        const res = await gitAction(worktreePath, "diff-file", { file: activeTab.relativePath });
        const files = parseUnifiedDiff(res.patch || "");
        const hunks = (files[0]?.chunks ?? []).map((c) => ({
          newStart: c.newStart,
          newLines: c.newLines,
          kind: c.changes.every((ch) => ch.type === "add") ? "add" as const
              : c.changes.every((ch) => ch.type === "del") ? "delete" as const
              : "modify" as const,
        }));
        const ed = editorRef.current as MonacoEditor;
        const m = monacoRef.current as MonacoApi;
        if (ed && m) applyGutterDecorations(ed, m, hunks);
      } catch { /* file may not be tracked — ignore */ }
    }, 300);
    return () => clearTimeout(handle);
  }, [activeTabPath, monacoReady, gutterTick]);
  ```

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Manual smoke**

  Open a tracked file in a worktree with uncommitted changes → confirm green/blue bars appear in the gutter on the lines you actually changed. Save the file → bars update.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/task/code-editor.tsx src/components/task/__tests__/code-editor.test.tsx
  git commit -m "feat(editor): VSCode-style gutter decorations driven by git diff-file"
  ```

### Phase 4 Checkpoint

- [ ] **Run all tests:** `pnpm test:run`
- [ ] **Empty marker commit:** `git commit --allow-empty -m "chore(phase4): editor gutter decorations complete"`

---

## Phase 5 (Optional): File History + Blame

Defer if Phases 1–4 took longer than estimated. Each task here is independent of the others; you can ship history alone.

### Task 12: `log-file` API + history panel

**Files:**
- Modify: `src/app/api/git/route.ts` (add `log-file` case)
- Create: `src/components/task/file-history-panel.tsx`
- Modify: `src/components/task/code-editor.tsx` (or wherever the file-action toolbar lives) — add a "History" button that opens the panel as a side drawer

Server: `case "log-file"` → `git.log({ file: safeFile, maxCount: 50 })` → return shortHash, subject, author, relative date.

UI: collapsible drawer next to the editor, list of commits with click-to-see-commit-diff. Reuse `DiffView` for the commit's per-file patch.

- [ ] Standard 6-step TDD flow (test → fail → implement → pass → smoke → commit). Estimate: 0.5 day.

### Task 13: `blame` API + overlay

**Files:**
- Modify: `src/app/api/git/route.ts` (add `blame` case)
- Create: `src/components/task/blame-overlay.tsx`

Server: `case "blame"` → `git.raw(["blame", "--porcelain", safeFile])`, parse into `{ line: number; sha: string; author: string; summary: string }[]`.

UI: thin column overlay pinned to the left of Monaco showing `sha[0..6] · author · age`. Toggled by a button in the editor toolbar. Hidden by default.

- [ ] Standard 6-step TDD flow. Estimate: 1 day (parser is fiddly).

### Phase 5 Checkpoint

- [ ] **Empty marker commit:** `git commit --allow-empty -m "chore(phase5): file history + blame complete"`

---

## Final Verification

- [ ] All tests pass: `pnpm test:run`
- [ ] Type-check passes: `pnpm tsc --noEmit` (or `pnpm typecheck` if defined)
- [ ] Lint passes: `pnpm lint`
- [ ] Manual smoke on macOS:
  - [ ] First-opened file syntax-highlights immediately
  - [ ] Side-by-side diff shows +/- highlights
  - [ ] 5k-line diff opens without freezing
  - [ ] Stage one hunk in a 2-hunk file → `git status` confirms partial stage
  - [ ] Editing a tracked file shows gutter bars; saving updates them
- [ ] Manual smoke on Windows (if available — otherwise mark as risk):
  - [ ] All of the above
- [ ] Update `.planning/ROADMAP.md` with v1.3 entry
- [ ] Update `MEMORY.md` if anything surprising surfaces during execution

---

## Risks & Open Questions

1. **`@git-diff-view/react` API drift** — the README check in Task 5 Step 1 must verify the exact component name + prop shape. If the API differs significantly, fall back to `react-diff-view` (older, more stable, lower-quality syntax highlighting). Estimate impact: +0.5 day.
2. **`git apply --cached` failures on stage-hunk** — if the file has been modified since the diff was fetched (race), `git apply` returns non-zero. UI must surface the i18n error `git.hunkApplyFailed` and refresh. Acceptable; matches VSCode behavior.
3. **Gutter decoration cost on huge files** — for files > 10k lines, fetching `diff-file` + parsing every 300ms could lag. Mitigation: skip if `model.getLineCount() > 10000` and log a warning. Defer to a follow-up if reported.
4. **Phase 5 blame parsing** — porcelain output is well-documented but verbose. Budget 1 day; if it's slipping at hour 6, defer to v1.4.
5. **Windows-only verification** — if no Windows machine is available during P1, ship Tasks 1 & 3 first and gate Task 2 behind a manual test on a colleague's Windows box.
