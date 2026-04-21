# Phase 64: Code Search - Research

**Researched:** 2026-04-21
**Domain:** Ripgrep integration, React tab layout, Monaco scroll-to-line
**Confidence:** HIGH

## Summary

Phase 64 adds a "搜索" tab to the task detail page's right panel, sitting alongside the existing "文件树" tab (within the "files" tab content area — it converts the current single file-tree pane into a two-tab sub-panel). Users type a regex pattern (and optional glob filter), the backend spawns `rg --json -n` scoped to `project.localPath`, results stream back as structured JSON and are rendered as file/line/content rows with inline highlighting. Clicking any row calls the existing `setSelectedFilePath` + `setActiveTab("files")` wiring and additionally passes a target line number so Monaco can `revealLineInCenter`.

Ripgrep 15.1.0 is confirmed installed on the host (`/opt/homebrew/bin/rg`). The JSON output format is stable and machine-friendly. The main integration work is: (1) a new server action `searchCode`, (2) a new `CodeSearch` component, (3) wiring the search tab into task-page-client, (4) extending `CodeEditor` to accept and act on `selectedLine`, and (5) adding i18n keys.

**Primary recommendation:** Keep search scoped to `project.localPath` (never `fileRootPath`/worktreePath) — this ensures search always covers the full project even during worktree execution. Use Enter-key trigger (not debounce) to avoid spamming the server on every keystroke of a regex.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- Add a "搜索" tab alongside existing "文件树", "变更", "预览" tabs in the left panel of task-page-client.tsx
  - NOTE from code inspection: the file tree lives in the RIGHT panel's "files" TabsContent — the left panel is the terminal. The search tab must be added to the right panel "files" tab area, as a sub-tab next to the file tree.
- Switching between tabs preserves file tree state (tabs component handles this natively)
- Search tab is always visible regardless of project type
- Backend: Server action or API route that spawns `rg` (ripgrep) with pattern scoped to project.localPath
- Input: regex pattern text input + optional file type/glob filter input
- Ripgrep command: `rg --json -n <pattern> [--glob <glob>] <localPath>` — JSON output for structured parsing
- Scope: always scoped to project.localPath (never searches outside project)
- Performance: results should appear within ~1s for typical codebases
- Error handling: detect if `rg` is not installed and show clear error message
- Each result row shows: file path (relative to localPath), line number, and matching line content
- Keyword highlighting: wrap matched text in a styled span (bg-yellow-200/50 or similar)
- Results grouped by file or flat list — Claude's discretion
- Limit results to a reasonable max (e.g., 200 matches) to avoid overwhelming the UI
- Clicking a result row calls the existing file-open handler with the file path and target line number
- Monaco editor scrolls to and highlights the matched line (revealLineInCenter or similar)
- Reuse existing FileTree → Monaco open-file wiring

### Claude's Discretion

- Exact UI layout of search input and filter fields
- Whether to debounce search input or require Enter key to trigger
- Result grouping (by file vs flat list)
- Maximum result count
- Whether to show a search icon in the tab or just text

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEARCH-01 | Detail page left panel has two tabs: "文件树" (existing) and "搜索" (new) | Sub-tabs within the "files" TabsContent; shadcn Tabs component already in use |
| SEARCH-02 | Search tab has input field with ripgrep-powered search scoped to project.localPath | New `searchCode` server action using `execFileSync` with `rg --json -n` |
| SEARCH-03 | Search supports regex patterns and file type/glob filtering | rg natively supports regex and `--glob`; pass both as args to `execFileSync` |
| SEARCH-04 | Search results display file path, line number, and matching line content with keyword highlighting | Parse rg JSON output; render submatches with `bg-yellow-200/50` spans |
| SEARCH-05 | Clicking a search result opens the file in Monaco editor at the matching line | Pass `selectedLine` prop to CodeEditor; call `editor.revealLineInCenter(line)` + `editor.setPosition` |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ripgrep (rg) | 15.1.0 (host) | Regex code search engine | Fastest searcher available; --json output is structured; already on host |
| Node.js child_process (execFileSync) | built-in | Spawn rg synchronously in server action | Existing pattern in preview-actions.ts and file-actions.ts |
| shadcn Tabs | project dep | Sub-tab UI inside file tree panel | Already used for the outer tab bar in task-page-client |
| @monaco-editor/react | 0.55.1 (project dep) | Scroll to matched line | Monaco IEditor.revealLineInCenter() API available |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | project dep | Validate server action inputs | Required per project security rules — validate localPath + pattern |
| ScrollArea | project dep | Scrollable results list | Used in file-tree for consistent scroll style |
| lucide-react | project dep | Search, X icons in search input | Matches icons used in file-tree search bar |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| execFileSync (sync) | spawnSync or spawn + event stream | spawn allows streaming but adds complexity; sync is fine for <200 results within 1s |
| Enter-key trigger | debounce (300ms) | Debounce hits server on every keystroke mid-regex; Enter is safer and matches VS Code ctrl+enter pattern |
| Flat results list | Grouped by file | Grouped matches VS Code convention better but adds rendering complexity; flat is simpler and still shows file path per row |

**Installation:** No new packages required. All dependencies already present in the project.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── actions/
│   └── search-code-actions.ts      # new: searchCode server action
├── components/task/
│   └── code-search.tsx             # new: search tab UI + results
└── app/workspaces/[workspaceId]/tasks/[taskId]/
    └── task-page-client.tsx        # modified: add search sub-tab inside files TabsContent
```

Also modify:
- `src/components/task/code-editor.tsx` — add `selectedLine?: number | null` prop
- `src/lib/i18n/zh.ts` and `src/lib/i18n/en.ts` — add new keys

### Pattern 1: Sub-Tabs Inside Files TabsContent

The current "files" TabsContent in task-page-client (lines 450–480) shows a horizontal split: file tree (w-60) on the left, Monaco on the right. The search tab converts the left side into a two-tab sub-panel.

```tsx
// Inside the "files" TabsContent:
<div className="flex h-full flex-row overflow-hidden">
  {/* Left: sub-tabs for file tree vs search */}
  <div className="w-60 flex-none border-r border-border overflow-hidden flex flex-col">
    <Tabs defaultValue="filetree" className="flex h-full flex-col gap-0">
      <div className="flex shrink-0 border-b border-border px-2 py-1.5">
        <TabsList className="h-auto border border-border w-full">
          <TabsTrigger value="filetree" className="flex-1 text-xs ...">
            <FolderTree className="h-3 w-3" />
            {t("taskPage.tabFiles")}
          </TabsTrigger>
          <TabsTrigger value="search" className="flex-1 text-xs ...">
            <Search className="h-3 w-3" />
            {t("taskPage.tabSearch")}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="filetree" className="flex-1 min-h-0 overflow-hidden">
        <FileTree ... />
      </TabsContent>
      <TabsContent value="search" className="flex-1 min-h-0 overflow-hidden">
        <CodeSearch
          localPath={task.project?.localPath ?? null}
          onResultSelect={(absolutePath, line) => {
            setSelectedFilePath(absolutePath);
            setSelectedLine(line);
          }}
        />
      </TabsContent>
    </Tabs>
  </div>
  {/* Right: Monaco editor */}
  <div className="flex-1 min-w-0 overflow-hidden">
    <CodeEditor
      worktreePath={fileRootPath}
      selectedFilePath={selectedFilePath}
      selectedLine={selectedLine}
      ...
    />
  </div>
</div>
```

### Pattern 2: searchCode Server Action

```typescript
// src/actions/search-code-actions.ts
"use server";

import { execFileSync } from "node:child_process";
import { z } from "zod";
import { safeResolvePath } from "@/lib/fs-security";

const searchSchema = z.object({
  localPath: z.string().min(1),
  pattern: z.string().min(1).max(500),
  glob: z.string().max(200).optional(),
  maxResults: z.number().int().min(1).max(500).default(200),
});

export interface SearchMatch {
  filePath: string;      // relative to localPath
  lineNumber: number;
  lineText: string;
  submatches: Array<{ start: number; end: number }>;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
  error?: string;
}

export async function searchCode(
  localPath: string,
  pattern: string,
  glob?: string,
  maxResults = 200
): Promise<SearchResult> {
  const { localPath: safePath, pattern: safePattern, glob: safeGlob } = searchSchema.parse({
    localPath, pattern, glob, maxResults,
  });

  // Security: validate localPath is absolute (not relative)
  if (!safePath.startsWith("/")) {
    throw new Error("localPath must be absolute");
  }

  // Check rg availability
  try {
    execFileSync("which", ["rg"], { stdio: "pipe" });
  } catch {
    return { matches: [], truncated: false, error: "ripgrep (rg) not installed" };
  }

  const args = ["--json", "-n", "--max-count", "1", safePattern];
  if (safeGlob) args.push("--glob", safeGlob);
  args.push(safePath);

  // Replace --max-count 1 with actual limit approach:
  // Use --max-total-matches (rg 14+) or collect and truncate
  const fullArgs = ["--json", "-n", safePattern];
  if (safeGlob) fullArgs.push("--glob", safeGlob);
  fullArgs.push(safePath);

  try {
    const output = execFileSync("rg", fullArgs, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB cap
      stdio: ["ignore", "pipe", "pipe"],
    });

    const matches: SearchMatch[] = [];
    let truncated = false;

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      let msg: { type: string; data: unknown };
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type !== "match") continue;

      const d = msg.data as {
        path: { text: string };
        line_number: number;
        lines: { text: string };
        submatches: Array<{ start: number; end: number }>;
      };

      if (matches.length >= maxResults) { truncated = true; break; }

      const absoluteFile = d.path.text;
      const relFile = absoluteFile.startsWith(safePath + "/")
        ? absoluteFile.slice(safePath.length + 1)
        : absoluteFile;

      matches.push({
        filePath: relFile,
        lineNumber: d.line_number,
        lineText: d.lines.text.replace(/\n$/, ""),
        submatches: d.submatches,
      });
    }

    return { matches, truncated };
  } catch (err: unknown) {
    // rg exits 1 when no matches found — treat as empty results
    const exitCode = (err as { status?: number }).status;
    if (exitCode === 1) return { matches: [], truncated: false };
    return { matches: [], truncated: false, error: String(err) };
  }
}
```

### Pattern 3: Monaco Scroll-to-Line

CodeEditor needs a `selectedLine` prop. When it changes, call `revealLineInCenter` on the editor instance:

```typescript
// In CodeEditor.tsx — add prop and useEffect
export interface CodeEditorProps {
  worktreePath: string;
  selectedFilePath: string | null;
  selectedLine?: number | null;   // NEW
  onFilePathChange?: (path: string | null) => void;
  onSave?: () => void;
}

// After activeTabPath stabilizes, scroll to line:
useEffect(() => {
  if (!selectedLine || !editorRef.current) return;
  const editor = editorRef.current as {
    revealLineInCenter: (line: number) => void;
    setPosition: (pos: { lineNumber: number; column: number }) => void;
  };
  // Small timeout to let Monaco render the model first
  const t = setTimeout(() => {
    editor.revealLineInCenter(selectedLine);
    editor.setPosition({ lineNumber: selectedLine, column: 1 });
  }, 50);
  return () => clearTimeout(t);
}, [selectedLine, activeTabPath]);
```

### Pattern 4: CodeSearch Component

```tsx
// src/components/task/code-search.tsx
"use client";

import { useState, useCallback, useRef } from "react";
import { Search, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { searchCode } from "@/actions/search-code-actions";
import type { SearchMatch } from "@/actions/search-code-actions";

interface CodeSearchProps {
  localPath: string | null;
  onResultSelect: (absolutePath: string, lineNumber: number) => void;
}

export function CodeSearch({ localPath, onResultSelect }: CodeSearchProps) {
  const { t } = useI18n();
  const [pattern, setPattern] = useState("");
  const [glob, setGlob] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef(false);

  const handleSearch = useCallback(async () => {
    if (!localPath || !pattern.trim()) return;
    setIsSearching(true);
    setError(null);
    abortRef.current = false;
    try {
      const result = await searchCode(localPath, pattern.trim(), glob.trim() || undefined);
      if (abortRef.current) return;
      if (result.error) { setError(result.error); setResults([]); }
      else { setResults(result.matches); setTruncated(result.truncated); }
    } catch (e) {
      setError(String(e));
    } finally {
      setIsSearching(false);
    }
  }, [localPath, pattern, glob]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  // ... render: pattern input, glob input, results list with highlighting
}
```

### Pattern 5: Keyword Highlighting in Results

Use submatch ranges from rg JSON output to split line text into highlighted/plain segments:

```tsx
function renderHighlighted(text: string, submatches: Array<{start: number; end: number}>) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const { start, end } of submatches) {
    if (cursor < start) parts.push(<span key={cursor}>{text.slice(cursor, start)}</span>);
    parts.push(
      <span key={start} className="bg-yellow-400/30 text-yellow-200 rounded-[2px] px-[1px]">
        {text.slice(start, end)}
      </span>
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(<span key={cursor}>{text.slice(cursor)}</span>);
  return parts;
}
```

### Anti-Patterns to Avoid

- **Debouncing ripgrep calls:** Every partial-regex keystroke may be invalid and causes server errors. Use Enter-key trigger only.
- **Using `shell: true` with execFileSync:** Security requirement from `.claude/rules/security.md` — args must be passed as an array, never shell-interpolated.
- **Searching worktreePath instead of localPath:** The worktree is a git checkout of one branch. Code search should cover the full project at `project.localPath`.
- **Not handling rg exit code 1:** rg exits 1 when no matches found — this is not an error. Must be caught and treated as empty results.
- **Leaking full absolute paths to client:** Strip `localPath` prefix before sending to client; display relative paths.
- **setState after component unmount:** Use an abort flag in the async search handler.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Code search engine | Custom recursive grep | ripgrep (rg) | rg handles .gitignore, binary detection, regex, Unicode, parallel processing |
| JSON output parsing | Custom text parsing | rg --json flag | Structured output with submatch byte offsets — no fragile regex on text |
| Path traversal prevention | Custom validation | safeResolvePath() from @/lib/fs-security | Already battle-tested in project |
| Input validation | Manual checks | Zod schema | Project convention (TypeScript security rules) |
| Scroll-to-line | Custom scroll calculation | Monaco IEditor.revealLineInCenter() | Official Monaco API — handles folded code, viewport math, etc. |

**Key insight:** ripgrep's `--json` mode returns structured `match` objects with exact `submatches` byte ranges — this eliminates the need to re-parse matched text to find highlight positions.

---

## Common Pitfalls

### Pitfall 1: rg Exit Code 1 Means "No Matches" (Not Error)

**What goes wrong:** `execFileSync` throws when exit code is non-zero. rg exits 1 for "no matches found" and 2+ for actual errors.
**Why it happens:** Unix convention: grep/rg use exit code 1 for no-match.
**How to avoid:** Wrap in try/catch; check `err.status === 1` → return empty results; only treat status >= 2 as error.
**Warning signs:** "Command failed with exit code 1" in server logs despite valid pattern.

### Pitfall 2: Invalid Regex Crashes the Action

**What goes wrong:** User types an incomplete regex like `(foo` — rg exits with error, server action throws.
**Why it happens:** rg validates regex patterns and fails fast on invalid ones.
**How to avoid:** Catch the thrown error, parse rg stderr for "regex parse error", return `{ error: "Invalid regex: ..." }` to client with user-friendly message.
**Warning signs:** Unhandled errors when user types partial patterns before pressing Enter.

### Pitfall 3: Large Codebases Returning Huge Output

**What goes wrong:** `execFileSync` with `maxBuffer` too small throws "stdout maxBuffer exceeded".
**Why it happens:** rg on a large codebase with a common pattern returns MBs of JSON.
**How to avoid:** Set `maxBuffer: 10 * 1024 * 1024` (10MB). Additionally pass `--max-count 1` per file or use a line budget collected during JSON parsing. Truncate at 200 matches and surface `truncated: true` to UI.
**Warning signs:** "Error: spawnSync rg ENOBUFS" in server logs.

### Pitfall 4: Monaco Model Not Loaded When scrollToLine Fires

**What goes wrong:** `revealLineInCenter` is called before Monaco has set the new model, so scroll is ignored.
**Why it happens:** `selectedFilePath` and `selectedLine` may update at the same time; model switch is async.
**How to avoid:** Apply a 50ms `setTimeout` in the `selectedLine` useEffect, or trigger scroll inside the model-switch useEffect after `editor.setModel(model)`.
**Warning signs:** Click result → file opens but cursor stays at top.

### Pitfall 5: Absolute Paths Sent to Client

**What goes wrong:** Full absolute paths like `/Users/john/project/src/foo.ts` are shown in the UI.
**Why it happens:** rg returns absolute paths by default.
**How to avoid:** Strip `localPath + "/"` prefix in the server action before returning. Client only needs the relative path for display; reconstruct absolute path as `localPath + "/" + relPath` when calling `onResultSelect`.
**Warning signs:** Results show full home directory path in the file column.

### Pitfall 6: Tabs Component Key Conflict

**What goes wrong:** Adding inner Tabs inside a TabsContent causes value collision if both use the same string values like "files".
**Why it happens:** shadcn Tabs uses React context — inner Tabs must use different value strings.
**How to avoid:** Use a separate set of values for the inner Tabs (e.g., `"filetree"` and `"search"`), not `"files"`.
**Warning signs:** Clicking inner tab switches outer tab unexpectedly.

---

## Code Examples

### rg JSON Output Format (verified against rg 15.1.0)

```json
{"type":"begin","data":{"path":{"text":"/path/to/file.ts"}}}
{"type":"match","data":{
  "path": {"text": "/path/to/file.ts"},
  "lines": {"text": "  const hello = \"world\";\n"},
  "line_number": 42,
  "absolute_offset": 1234,
  "submatches": [{"match":{"text":"hello"},"start":8,"end":13}]
}}
{"type":"end","data":{"path":{"text":"/path/to/file.ts"},...}}
{"type":"summary","data":{...}}
```

### execFileSync Security Pattern (from preview-actions.ts)

```typescript
// CORRECT: shell: false (default for execFileSync), args as array
execFileSync("rg", ["--json", "-n", pattern, localPath], {
  encoding: "utf-8",
  maxBuffer: 10 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});

// WRONG: shell interpolation risk
execFileSync(`rg --json -n ${pattern} ${localPath}`, { shell: true });
```

### Monaco revealLineInCenter API

```typescript
// editor is IStandaloneCodeEditor
editor.revealLineInCenter(lineNumber); // scrolls so line is in center of viewport
editor.setPosition({ lineNumber, column: 1 }); // moves cursor to the line
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| rg text output parsing | rg --json structured output | rg 0.10+ (2018) | Exact byte offsets for submatches; no fragile text regex |
| Monaco `scrollToLine` | `revealLineInCenter` | Monaco 0.20+ | Ensures line is visible in viewport center, handles folding |

---

## Open Questions

1. **Tab placement: sub-tabs vs outer tab bar**
   - What we know: CONTEXT.md says "Add a '搜索' tab alongside existing '文件树' tabs in the left panel" but the code inspection reveals the file tree is in the RIGHT panel's "files" TabsContent, not the left panel (left = terminal).
   - What's unclear: Should search be another top-level tab in the right panel (alongside "文件树"/"变更"/"预览"), or a sub-tab within the "files" TabsContent?
   - Recommendation: Sub-tab within "files" TabsContent. This matches VS Code's pattern (Explorer panel has File Tree + Search as sub-views) and avoids making the top tab bar wider with a 4th tab that competes with "变更" and "预览". The CONTEXT.md user quote "在现在的文件树所在区域搜索就行了" ("search right where the file tree is") confirms this.

2. **rg max-total-matches flag availability**
   - What we know: rg 15.1.0 is installed; `--max-total-matches` was added in rg 14.0.
   - What's unclear: Whether to use `--max-total-matches 200` (cleanest) or manual line-count truncation.
   - Recommendation: Use manual truncation (break loop after 200 matches) — portable across all rg versions, no flag uncertainty.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| ripgrep (rg) | SEARCH-02, SEARCH-03 | Yes | 15.1.0 | Show error message "ripgrep not installed" per CONTEXT.md decision |
| Node.js child_process | searchCode server action | Yes (built-in) | N/A | — |
| @monaco-editor/react | SEARCH-05 scroll-to-line | Yes (project dep) | 0.55.1 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- rg not installed: surface clear error in CodeSearch component UI (locked decision).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest + jsdom |
| Config file | vitest.config.ts |
| Quick run command | `pnpm test:run -- search-code` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEARCH-01 | Files tab has sub-tabs "filetree" and "search" | unit (component) | manual visual check | No — Wave 0 |
| SEARCH-02 | searchCode action calls rg with localPath scope | unit | `pnpm test:run -- search-code-actions` | No — Wave 0 |
| SEARCH-03 | searchCode passes glob filter when provided | unit | `pnpm test:run -- search-code-actions` | No — Wave 0 |
| SEARCH-04 | Results include filePath, lineNumber, lineText, submatches | unit | `pnpm test:run -- search-code-actions` | No — Wave 0 |
| SEARCH-05 | Monaco scrolls to matched line on result click | unit | manual visual check / monaco mock | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run -- search-code-actions`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/actions/__tests__/search-code-actions.test.ts` — covers SEARCH-02, SEARCH-03, SEARCH-04
  - Mock `child_process` with `vi.hoisted()` (required per Phase 62 decision for jsdom environment)
  - Test: rg exit 0 → returns matches
  - Test: rg exit 1 → returns empty matches (not error)
  - Test: rg exit 2 (error) → returns error string
  - Test: invalid pattern → returns error
  - Test: glob filter → passed as --glob arg
  - Test: truncation at maxResults limit

---

## Project Constraints (from CLAUDE.md)

- **Package manager:** pnpm (not npm/yarn)
- **i18n:** All user-visible strings via `t("key")` — must add zh + en keys for new UI text
- **Next.js 15+ params:** `const { id } = await params` — not relevant here (no route params in actions)
- **App Router routes:** `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"` — not applicable to server actions
- **Select component:** No `<SelectValue />` — use manual `<span>` (not applicable here, no selects in this feature)
- **Toast:** Sonner (`import { toast } from "sonner"`) for error feedback
- **Button sizing:** Default size (`h-8`), never `size="sm"`
- **Icon buttons:** `text-muted-foreground hover:bg-accent hover:text-foreground` with `transition-colors`
- **No shell: true in child_process:** All CLI calls use args array (security rule)
- **safeResolvePath:** Must use for any path resolved against user-supplied data
- **Server actions security:** Validate with Zod, catch Prisma P2025 (not applicable here)
- **Test pattern:** `vi.hoisted()` for child_process mock in jsdom vitest (confirmed by Phase 62 decision)
- **TooltipTrigger:** render prop pattern, not asChild (not applicable here)

---

## Sources

### Primary (HIGH confidence)

- Codebase inspection: `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` — confirmed right panel tab structure, `fileRootPath` vs `localPath` distinction
- Codebase inspection: `src/components/task/code-editor.tsx` — confirmed no existing `selectedLine` prop; `editorRef` available for imperative scroll
- Codebase inspection: `src/components/task/file-tree.tsx` — confirmed existing file name search pattern (Fuse.js); code search is a separate concern (content search, not file name search)
- Codebase inspection: `src/actions/preview-actions.ts` — confirmed `execFileSync` with args array pattern
- Codebase inspection: `src/lib/fs-security.ts` — `safeResolvePath` available
- Shell: `rg --version` → ripgrep 15.1.0 at `/opt/homebrew/bin/rg`
- Shell: `rg --json` output format verified against live rg run in project directory
- Monaco API: `revealLineInCenter` is a standard IEditor method in @monaco-editor/react 0.55.x

### Secondary (MEDIUM confidence)

- Monaco `revealLineInCenter` scroll behavior (50ms setTimeout workaround for async model switch) — inferred from Monaco's async rendering model; standard pattern in Monaco integrations

### Tertiary (LOW confidence)

- None

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all dependencies confirmed present via package.json and shell checks
- Architecture: HIGH — based on direct code reading of all integration points
- Pitfalls: HIGH — rg exit codes and Monaco async behavior are well-documented behaviors

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable APIs)
