# Phase 20: File Tree Browser - Research

**Researched:** 2026-03-31
**Domain:** React file tree component, Node.js fs/path APIs, gitignore filtering, git status
**Confidence:** HIGH

## Summary

Phase 20 delivers a custom file tree browser for the workbench Files tab. All architectural decisions are locked in CONTEXT.md — the implementation is clear and straightforward. No third-party tree library is used; the component is a custom recursive ~80-line React component with lazy loading, gitignore filtering via the `ignore` npm package (already available in the pnpm virtual store as a transitive dependency), and git status badges from `git diff --name-status`.

The primary risk is the `ignore` package not being a direct dependency — it needs to be added to `package.json` via `pnpm add ignore`. All other dependencies (lucide-react, ScrollArea, Dialog, Tooltip, Tailwind v4, useI18n) are already present. The server action pattern, safeResolvePath utility, and file icon mapping are all fully specified in CONTEXT.md and the UI-SPEC.

**Primary recommendation:** Create `src/lib/fs-security.ts` (safeResolvePath), `src/actions/file-actions.ts` (5 server actions), and the 3 component files (FileTree, FileTreeNode, FileTreeContextMenu) in that order. Add `ignore` as a direct dependency first.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** New `src/actions/file-actions.ts` with server actions: `listDirectory(worktreePath, relativePath)`, `createFile(worktreePath, relativePath)`, `createDirectory(worktreePath, relativePath)`, `renameEntry(worktreePath, oldPath, newPath)`, `deleteEntry(worktreePath, relativePath)`. All path-validated via safeResolvePath.
- **D-02:** `safeResolvePath(base, relative)` utility in `src/lib/fs-security.ts` — uses `path.resolve(base, relative)` + `startsWith(base)` check. Returns resolved absolute path or throws. Reused by Phase 21 editor file read/write.
- **D-03:** gitignore filtering via `ignore` npm package — parse `.gitignore` from worktree root, filter entries server-side in `listDirectory` before returning to client. Never expose gitignored files.
- **D-04:** Lazy directory loading — only list immediate children on expand. Fetch deeper levels on demand when user expands folders.
- **D-05:** File icons via lucide-react mapping: `.ts/.tsx`→FileCode, `.json`→FileJson, `.md`→FileText, `.css/.scss`→Palette, folder→Folder/FolderOpen, default→File. No external icon package.
- **D-06:** Custom right-click context menu — positioned absolute div with portal to document.body, triggered by `onContextMenu`. Shows: New File, New Folder, Rename, Delete (with separator before Delete).
- **D-07:** Auto-refresh via `setInterval(2000)` polling when task execution status is RUNNING — stop interval when not executing. Parent component passes execution status down.
- **D-08:** Git status from `git diff --name-status baseBranch...taskBranch` — parsed server-side into `Map<relativePath, 'M'|'A'|'D'>`, returned alongside directory listing or as separate endpoint.
- **D-09:** Create file/folder uses inline rename-style input — new entry appears in tree with editable name field at the target location, press Enter to create, Escape to cancel.
- **D-10:** Delete shows simple confirm dialog — "Delete {name}?" with cancel/delete buttons. Prevent deleting `.git/` directory.
- **D-11:** Rename via inline edit — click context menu "Rename" to make filename editable, press Enter to save, Escape to cancel.

### Claude's Discretion

- Component file structure (single file vs split into sub-components)
- Exact Tailwind styling for tree nodes, indentation, context menu
- Whether to show file sizes or last-modified dates in the tree
- Whether to highlight the currently selected/open file
- i18n key naming for context menu items and error messages

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FT-01 | 用户可浏览任务 worktree 的目录结构（展开/折叠文件夹，文件图标） | D-04 lazy load + D-05 icon mapping; recursive FileTreeNode component |
| FT-02 | 点击文件树中的文件在编辑器中打开 | `onFileSelect(absolutePath)` callback wired into FileTree; no-op in Phase 20, consumed in Phase 21 |
| FT-03 | 文件树自动过滤 gitignore 规则匹配的目录和文件 | D-03 `ignore` package server-side in `listDirectory`; never returned to client |
| FT-04 | Claude 执行期间文件树每 2 秒自动刷新 | D-07 `setInterval(2000)` gated on executionStatus === 'RUNNING' |
| FT-05 | 用户可通过右键菜单新建文件/文件夹、重命名、删除 | D-06 context menu portal + D-09 inline create + D-10 delete dialog + D-11 inline rename |
| FT-06 | 文件树节点显示 git 变更状态标记（M/A/D） | D-08 `git diff --name-status baseBranch...taskBranch` parsed server-side |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ignore` | 7.0.5 | gitignore rule parsing/filtering | Industry standard; used by eslint, gitbook; already in pnpm virtual store |
| `lucide-react` | ^1.6.0 | File type icons (FileCode, FileJson, FileText, Palette, Folder, FolderOpen, File) | Already installed; project-standard icon library |
| `react` | 19.2.4 | Recursive tree component, hooks (useState, useEffect, useCallback, useRef) | Project foundation |
| Node.js `fs/promises` | built-in | `readdir`, `mkdir`, `rename`, `rm` for file CRUD operations | No install needed; server-only |
| Node.js `path` | built-in | Path joining and resolution in safeResolvePath | No install needed |
| Node.js `child_process` | built-in | `execFileSync` for `git diff --name-status` | Already used in git-actions.ts |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@/components/ui/scroll-area` | existing | Wrap entire file tree for overflow | Already installed via shadcn |
| `@/components/ui/dialog` | existing | Delete confirmation modal | Already installed via shadcn |
| `@/components/ui/tooltip` | existing | Full path on hover for truncated filenames | Already installed via shadcn |
| `react-dom` createPortal | built-in | Context menu portal to document.body | No install; part of react-dom already used |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom recursive tree | `react-arborist`, `react-complex-tree` | Locked decision: custom ~80-line component is simpler and sufficient |
| `ignore` package | Manual gitignore parsing | `ignore` handles all edge cases (negation, patterns, slashes); hand-rolling is error-prone |
| `setInterval` polling | `fs.watch` or WebSocket | STATE.md explicitly: "File tree polling triggered by status_changed SSE events (2s interval during execution), not fs.watch — avoids inotify exhaustion" |
| Portal context menu | shadcn `DropdownMenu` | DropdownMenu requires a trigger element; right-click position is arbitrary — locked to custom portal div |

**Installation:**
```bash
pnpm add ignore
```

**Note:** `ignore` v7.0.5 is already in the pnpm virtual store (transitive dependency of eslint). Adding it as a direct dependency makes the import valid in application code. Verify current version with `npm view ignore version`.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   └── fs-security.ts       # safeResolvePath utility (D-02)
├── actions/
│   └── file-actions.ts      # 5 server actions: list/create/rename/delete (D-01)
└── components/task/
    ├── file-tree.tsx         # Root component: polling, git status, data fetch
    ├── file-tree-node.tsx    # Recursive node: icon, label, inline edit, context menu trigger
    └── file-tree-context-menu.tsx  # Portal context menu (absolute div on document.body)
```

### Pattern 1: safeResolvePath Utility

**What:** Validates that a resolved path stays within the worktree base directory. Prevents path traversal attacks.

**When to use:** Every file operation server action must call this before touching the filesystem.

**Example:**
```typescript
// src/lib/fs-security.ts
import path from "path";

export function safeResolvePath(base: string, relative: string): string {
  const resolved = path.resolve(base, relative);
  const safeBase = base.endsWith(path.sep) ? base : base + path.sep;
  if (!resolved.startsWith(safeBase) && resolved !== base) {
    throw new Error(`Path traversal detected: ${relative}`);
  }
  return resolved;
}
```

Reference: existing pattern in `src/lib/file-serve.ts` (`resolveAssetPath` uses the same `startsWith(safePrefix)` check).

### Pattern 2: listDirectory Server Action

**What:** Reads a directory's immediate children, filters via gitignore, returns typed entries.

**When to use:** Called on initial load and on every expand event.

**Example:**
```typescript
// src/actions/file-actions.ts
"use server";
import { readdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import ignore from "ignore";
import { execFileSync } from "child_process";
import { safeResolvePath } from "@/lib/fs-security";

export interface FileEntry {
  name: string;
  relativePath: string;  // relative to worktreePath
  isDirectory: boolean;
  gitStatus?: "M" | "A" | "D";
}

export async function listDirectory(
  worktreePath: string,
  relativePath: string = "."
): Promise<FileEntry[]> {
  const absoluteDir = safeResolvePath(worktreePath, relativePath);

  // Read gitignore from worktree root
  const ig = ignore();
  const gitignorePath = path.join(worktreePath, ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, "utf-8");
    ig.add(content);
  }
  // Always filter .git directory
  ig.add(".git");

  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const filtered = entries.filter((e) => {
    const rel = path.relative(worktreePath, path.join(absoluteDir, e.name));
    return !ig.ignores(rel);
  });

  return filtered
    .sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((e) => ({
      name: e.name,
      relativePath: path.relative(worktreePath, path.join(absoluteDir, e.name)),
      isDirectory: e.isDirectory(),
    }));
}
```

### Pattern 3: Git Status Parsing (D-08)

**What:** Run `git diff --name-status baseBranch...taskBranch` server-side, parse into a map.

**When to use:** Called alongside or after `listDirectory`; result attached to FileEntry items or returned as a separate `Map`.

**Example:**
```typescript
export async function getGitStatus(
  worktreePath: string,
  baseBranch: string,
  taskBranch: string
): Promise<Record<string, "M" | "A" | "D">> {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-status", `${baseBranch}...${taskBranch}`],
      { cwd: worktreePath, encoding: "utf-8", timeout: 10000 }
    );
    const result: Record<string, "M" | "A" | "D"> = {};
    for (const line of output.split("\n").filter(Boolean)) {
      const [status, filePath] = line.split("\t");
      if (status === "M" || status === "A" || status === "D") {
        result[filePath] = status as "M" | "A" | "D";
      }
    }
    return result;
  } catch {
    return {};
  }
}
```

Reference: `git-actions.ts` uses same `execFileSync` + `cwd` pattern; `worktree.ts` uses same error tolerance.

### Pattern 4: Auto-Refresh Interval (D-07)

**What:** `setInterval(2000)` active only when `executionStatus === 'RUNNING'`.

**When to use:** FileTree root component, based on prop from parent.

**Example:**
```typescript
// Inside FileTree component
useEffect(() => {
  if (executionStatus !== "RUNNING") return;
  const interval = setInterval(() => {
    refreshTree(); // re-fetch open directories
  }, 2000);
  return () => clearInterval(interval);
}, [executionStatus]);
```

**Critical:** On refresh, preserve expand/collapse state of already-opened folders. Use a `Set<string>` of expanded paths in state. Refresh only re-fetches children for paths in the set — do not collapse folders.

### Pattern 5: Context Menu Portal (D-06)

**What:** Absolute-positioned div rendered via `createPortal` into `document.body`. Dismissed on click-outside or Escape key.

**When to use:** Right-click on any file tree node.

**Example:**
```typescript
// Dismiss logic
useEffect(() => {
  if (!menuState) return;
  const handleMousedown = (e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setMenuState(null);
    }
  };
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") setMenuState(null);
  };
  document.addEventListener("mousedown", handleMousedown);
  document.addEventListener("keydown", handleKeydown);
  return () => {
    document.removeEventListener("mousedown", handleMousedown);
    document.removeEventListener("keydown", handleKeydown);
  };
}, [menuState]);
```

**Position:** `{ top: event.clientY, left: event.clientX }` — capture in `onContextMenu` handler and prevent default.

### Pattern 6: Inline Create/Rename Input (D-09, D-11)

**What:** Replace filename span with `<input>` on rename; insert ghost row on create.

**When to use:** After context menu "Rename" or "New File"/"New Folder" is clicked.

**Example (rename):**
```typescript
// In FileTreeNode
const [isRenaming, setIsRenaming] = useState(false);
const [renameValue, setRenameValue] = useState(entry.name);
const inputRef = useRef<HTMLInputElement>(null);

// Focus on mount
useEffect(() => {
  if (isRenaming) inputRef.current?.select();
}, [isRenaming]);

// Render
{isRenaming ? (
  <input
    ref={inputRef}
    value={renameValue}
    onChange={(e) => setRenameValue(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Enter") handleRenameSubmit();
      if (e.key === "Escape") { setIsRenaming(false); setRenameValue(entry.name); }
    }}
    className="ring-1 ring-primary rounded-sm px-1 text-[13px] w-full"
  />
) : (
  <span className="truncate">{entry.name}</span>
)}
```

### Pattern 7: FileTree Component Integration

**What:** FileTree receives props from task-page-client.tsx; exposes `onFileSelect` callback for Phase 21.

**When to use:** Replace the placeholder in `TabsContent value="files"`.

**Props interface:**
```typescript
interface FileTreeProps {
  worktreePath: string | null;   // from TaskExecution.worktreePath; null = show empty state
  baseBranch: string | null;     // from Task.baseBranch; for git diff
  worktreeBranch: string | null; // from TaskExecution.worktreeBranch; for git diff
  executionStatus: string;       // e.g. "RUNNING", "COMPLETED"; gates auto-refresh
  onFileSelect: (absolutePath: string) => void; // no-op in Phase 20; consumed by Phase 21
}
```

**task-page-client.tsx changes needed:**
1. Fetch the latest `TaskExecution` with `worktreePath` and `worktreeBranch` from `getTaskExecutions(task.id)`.
2. Pass `worktreePath`, `baseBranch`, `worktreeBranch`, and `taskStatus` (as `executionStatus`) to `<FileTree>`.
3. Handle `onFileSelect` as a state setter for the selected file path (consumed in Phase 21).

### Anti-Patterns to Avoid

- **Never call `execFileSync` with shell interpolation:** Always use `execFileSync("git", ["diff", ...args])` array form. The project enforces this (see recent commit: `fix(security): migrate execSync to execFileSync to prevent command injection`).
- **Never use `fs.watch` for auto-refresh:** STATE.md explicitly bans this — use `setInterval` polling to avoid inotify exhaustion.
- **Never expose gitignored paths to client:** Filter server-side in `listDirectory`; never return them in the response.
- **Never allow `.git/` deletion:** Check `entry.name === ".git"` before showing Delete in context menu. D-10 explicitly forbids this.
- **Never call `path.resolve(base, relative)` without the startsWith check:** The safeResolvePath utility must wrap every fs operation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| gitignore rule parsing | Custom regex parser | `ignore` npm package | Handles negation (`!`), directory marks (`/`), globbing, character classes — many edge cases |
| Git diff parsing | Custom string parsing | `execFileSync("git", ["diff", "--name-status", ...])` | Git already parses the diff; `--name-status` gives a clean, structured output |
| Path traversal prevention | Ad-hoc checks | `safeResolvePath` utility | D-02 specifies exact implementation; reused in Phase 21 |
| File CRUD | Browser File System API | Node.js `fs/promises` via server actions | Server actions run in Node.js; browser FS API is sandboxed and not applicable |

**Key insight:** The custom recursive component keeps complexity low (~80 lines per STATE.md); don't introduce a tree library that adds bundle weight and API complexity for a straightforward two-level hierarchy (files + folders).

## Common Pitfalls

### Pitfall 1: `ignore` Package Not a Direct Dependency

**What goes wrong:** TypeScript can't resolve `import ignore from "ignore"` even though the package is in the pnpm virtual store as a transitive dependency. Build fails.
**Why it happens:** `ignore` v7.0.5 is in `.pnpm/` as a transitive dep of eslint, not a direct project dep. Direct imports require a direct `package.json` entry.
**How to avoid:** Run `pnpm add ignore` before writing any code that imports it. Verify with `ls node_modules/ignore`.
**Warning signs:** TypeScript error `Cannot find module 'ignore'` during build.

### Pitfall 2: gitignore Filter Applied to Absolute Paths

**What goes wrong:** `ig.ignores("/home/user/project/src/index.ts")` always returns `false` — `ignore` requires relative paths relative to the repo root.
**Why it happens:** The `ignore` package spec requires paths to be relative to the repository root (where `.gitignore` lives), not absolute.
**How to avoid:** Always use `path.relative(worktreePath, absoluteEntryPath)` before calling `ig.ignores(rel)`.
**Warning signs:** gitignored files appear in the tree (e.g., `node_modules/` shows up).

### Pitfall 3: Expand State Wiped on Auto-Refresh

**What goes wrong:** Every 2-second auto-refresh collapses all folders the user had opened.
**Why it happens:** Naive implementation re-renders tree from scratch, resetting all `isExpanded` state.
**How to avoid:** Store expanded paths in a `Set<string>` in the root `FileTree` state. On refresh, only re-fetch children for paths in the set. Pass `defaultExpanded` or controlled `isExpanded` into `FileTreeNode`.
**Warning signs:** Users report that folders they opened keep closing during execution.

### Pitfall 4: Context Menu Stays Open After Navigation

**What goes wrong:** Right-click menu persists when user clicks outside or scrolls, blocking interaction.
**Why it happens:** Missing `mousedown` document listener or missing cleanup in `useEffect`.
**How to avoid:** Always return a cleanup function from `useEffect` that removes both `mousedown` and `keydown` listeners. Use `useRef` for the menu DOM node to check `contains`.
**Warning signs:** Context menu stays visible after clicking elsewhere.

### Pitfall 5: execFileSync Shell Injection (Security)

**What goes wrong:** Using `execSync(\`git diff ${baseBranch}...${taskBranch}\`)` is vulnerable to shell injection if branch names contain shell metacharacters.
**Why it happens:** Template string interpolation into `execSync` (string form) passes through shell.
**How to avoid:** Always use `execFileSync("git", ["diff", "--name-status", `${baseBranch}...${taskBranch}`], { cwd: worktreePath })`. The array form bypasses shell entirely.
**Warning signs:** Linter or security reviewer flags `execSync` usage. Also check: the project's most recent commit is explicitly about this fix — do not regress.

### Pitfall 6: Forgetting to Pass worktreePath from TaskExecution

**What goes wrong:** `FileTree` receives `null` for `worktreePath` even when the task has been executed, showing the empty state incorrectly.
**Why it happens:** `task-page-client.tsx` doesn't currently fetch `TaskExecution` data; it only has `task` props. `worktreePath` lives on `TaskExecution`, not `Task`.
**How to avoid:** Add a `useEffect` on mount that calls `getTaskExecutions(task.id)` and picks the most recent one's `worktreePath` and `worktreeBranch`. Update state on each `status_changed` SSE event as well.
**Warning signs:** File tree always shows empty state despite task having run.

### Pitfall 7: Delete confirmation for folders not noting recursive deletion

**What goes wrong:** User deletes a folder without understanding all children are removed.
**Why it happens:** Generic "Delete {name}?" dialog doesn't distinguish files from folders.
**How to avoid:** UI-SPEC specifies different dialog body for folders: 「{name}」及其所有内容将被删除。 Show this when `entry.isDirectory === true`.
**Warning signs:** User accidentally deletes folder tree without understanding impact.

## Code Examples

Verified patterns from official sources and the existing codebase:

### safeResolvePath (from existing file-serve.ts pattern)

```typescript
// src/lib/fs-security.ts
// Source: derived from existing resolveAssetPath in src/lib/file-serve.ts
import path from "path";

export function safeResolvePath(base: string, relative: string): string {
  const resolved = path.resolve(base, relative);
  const safeBase = base.endsWith(path.sep) ? base : base + path.sep;
  // Allow exact match (relative = ".") or subpath
  if (resolved !== base && !resolved.startsWith(safeBase)) {
    throw new Error(`Path traversal attempt: ${relative}`);
  }
  return resolved;
}
```

### ignore package usage (from official README)

```typescript
// Source: ignore package README / index.d.ts
import ignore from "ignore";

const ig = ignore();
ig.add(".git\nnode_modules\ndist");
// Must pass RELATIVE paths
ig.ignores("node_modules/lodash/index.js"); // true
ig.ignores("src/index.ts");                 // false
```

### execFileSync git diff (from existing worktree.ts pattern)

```typescript
// Source: src/lib/worktree.ts pattern
import { execFileSync } from "child_process";

const output = execFileSync(
  "git",
  ["diff", "--name-status", `${baseBranch}...${taskBranch}`],
  { cwd: worktreePath, encoding: "utf-8", timeout: 10000 }
);
```

### createPortal context menu (standard React pattern)

```typescript
// Source: React docs — createPortal
import { createPortal } from "react-dom";

// Inside component render:
{menuState && createPortal(
  <div
    ref={menuRef}
    style={{ position: "fixed", top: menuState.y, left: menuState.x, zIndex: 9999 }}
    className="bg-popover border border-border rounded-md shadow-md py-1 min-w-[160px]"
  >
    {/* menu items */}
  </div>,
  document.body
)}
```

### Interval cleanup pattern (from task-page-client.tsx)

```typescript
// Source: task-page-client.tsx — cancelled flag pattern already used in this file
useEffect(() => {
  if (executionStatus !== "RUNNING") return;
  const interval = setInterval(refreshTree, 2000);
  return () => clearInterval(interval);
}, [executionStatus, refreshTree]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `execSync` with shell string | `execFileSync` with args array | Phase 18 (security fix) | Must use execFileSync throughout this phase |
| `fs.watch` for file change detection | `setInterval` polling | v0.6 Roadmap decision | Avoids inotify exhaustion on Linux |
| Third-party tree components | Custom recursive component | v0.6 Roadmap | Keeps bundle lean; sufficient for this use case |

**No deprecated approaches in scope.** The `ignore` package v7 is the current stable release. The API has been stable across major versions.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js `fs/promises` | File CRUD server actions | ✓ | Built-in (Node 22) | — |
| Node.js `path` | safeResolvePath | ✓ | Built-in | — |
| `execFileSync` (child_process) | git diff status | ✓ | Built-in | — |
| `git` CLI | FT-06 git status badges | ✓ | Project uses git throughout | Fall back to empty status map |
| `ignore` npm package | FT-03 gitignore filtering | Available in pnpm virtual store | 7.0.5 | Must add as direct dep via `pnpm add ignore` |
| `lucide-react` | File icons (D-05) | ✓ | ^1.6.0 | — |
| `ScrollArea` component | Tree overflow | ✓ | shadcn, already installed | — |
| `Dialog` component | Delete confirmation | ✓ | shadcn, already installed | — |
| `Tooltip` component | Truncated filename hover | ✓ | shadcn, already installed | — |
| `react-dom` createPortal | Context menu portal | ✓ | 19.2.4 already installed | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies requiring action:**
- `ignore` must be added as a direct dependency: `pnpm add ignore`. It is currently only available as a transitive dep of eslint and cannot be imported in application code.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.1 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test:run -- --reporter=verbose tests/unit/lib/fs-security.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FT-01 | `listDirectory` returns sorted entries with isDirectory flag | unit | `pnpm test:run -- tests/unit/actions/file-actions.test.ts` | ❌ Wave 0 |
| FT-01 | `safeResolvePath` throws on path traversal attempt | unit | `pnpm test:run -- tests/unit/lib/fs-security.test.ts` | ❌ Wave 0 |
| FT-03 | `listDirectory` filters gitignored entries | unit | `pnpm test:run -- tests/unit/actions/file-actions.test.ts` | ❌ Wave 0 |
| FT-03 | `listDirectory` always filters `.git/` directory | unit | `pnpm test:run -- tests/unit/actions/file-actions.test.ts` | ❌ Wave 0 |
| FT-05 | `createFile` / `createDirectory` / `renameEntry` / `deleteEntry` succeed for valid paths | unit | `pnpm test:run -- tests/unit/actions/file-actions.test.ts` | ❌ Wave 0 |
| FT-05 | `deleteEntry` refuses to delete `.git/` | unit | `pnpm test:run -- tests/unit/actions/file-actions.test.ts` | ❌ Wave 0 |
| FT-06 | `getGitStatus` parses `M`, `A`, `D` lines correctly | unit | `pnpm test:run -- tests/unit/actions/file-actions.test.ts` | ❌ Wave 0 |
| FT-06 | `getGitStatus` returns empty map on git error | unit | `pnpm test:run -- tests/unit/actions/file-actions.test.ts` | ❌ Wave 0 |
| FT-02 | FileTree renders file nodes; click calls `onFileSelect` | unit (component) | `pnpm test:run -- tests/unit/components/file-tree.test.tsx` | ❌ Wave 0 |
| FT-04 | Auto-refresh interval starts on RUNNING, stops otherwise | unit (component) | `pnpm test:run -- tests/unit/components/file-tree.test.tsx` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run -- tests/unit/lib/fs-security.test.ts tests/unit/actions/file-actions.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/lib/fs-security.test.ts` — covers safeResolvePath path traversal cases
- [ ] `tests/unit/actions/file-actions.test.ts` — covers listDirectory (with gitignore mock), CRUD ops, getGitStatus
- [ ] `tests/unit/components/file-tree.test.tsx` — covers FT-02 click callback, FT-04 interval behavior

**Test environment:** `// @vitest-environment node` required for fs-security.test.ts and file-actions.test.ts (Node.js APIs). Component tests use default jsdom environment (per vitest.config.ts).

**Mocking required:**
- `fs/promises` (readdir, readFile, mkdir, rename, rm) — mock in file-actions tests
- `child_process.execFileSync` — mock in file-actions tests for git status
- `next/cache.revalidatePath` — mock in file-actions tests (standard project pattern; see worktree.test.ts)

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **No execSync with shell strings** — must use `execFileSync` with args array (recent security fix, enforced by project)
- **This is NOT the standard Next.js** — read `node_modules/next/dist/docs/` before writing Next.js-specific code (App Router, server actions)
- **Zod validation in server actions** — validate inputs with Zod before calling fs operations
- **No `console.log` in production code** — use proper error handling; delete all debug logs before commit
- **Immutability** — never mutate state directly; use spread/functional updates
- **Files ≤ 800 lines** — if FileTree component grows, split into FileTreeNode and FileTreeContextMenu (as recommended in UI-SPEC)
- **useI18n() hook** — all user-visible strings must use the hook; add both `zh` and `en` keys to `src/lib/i18n.tsx`
- **Tailwind v4** — CSS variables, no tailwind.config.js; use `bg-accent`, `text-muted-foreground` etc.

## Open Questions

1. **TaskExecution data fetch in task-page-client.tsx**
   - What we know: `task-page-client.tsx` currently receives `task` props without `TaskExecution` data. `worktreePath` lives on `TaskExecution`.
   - What's unclear: Should we add a `getLatestExecution` server action and call it in a `useEffect`, or should the page server component pass the execution data as a prop?
   - Recommendation: Pass `latestExecution` as a prop from the page server component (simpler, SSR-friendly). The page already serializes `task` as props — extend with `latestExecution?: { worktreePath: string | null, worktreeBranch: string | null, status: string }`.

2. **git diff branch existence**
   - What we know: `getGitStatus` uses `baseBranch...taskBranch`. If the task branch doesn't exist yet (task never executed), git diff will fail.
   - What's unclear: Should we check branch existence before running diff?
   - Recommendation: Wrap in try/catch returning empty map (already specified in D-08's "returned alongside directory listing or as separate endpoint"). The `worktreePath` being null is a sufficient guard — if no worktree, no git status needed.

3. **Scroll area sizing in the resizable panel**
   - What we know: The Files tab uses `flex-1 overflow-hidden` on TabsContent; FileTree should be `h-full`.
   - What's unclear: Whether `ScrollArea` from shadcn needs explicit height or inherits from flex parent.
   - Recommendation: UI-SPEC specifies `h-full flex flex-col` on FileTree with `flex-1` on the ScrollArea. Test in browser after implementation; shadcn ScrollArea needs an explicit height or flex-1 parent.

## Sources

### Primary (HIGH confidence)

- Existing codebase (`src/lib/file-serve.ts`) — safeResolvePath pattern (resolveAssetPath)
- Existing codebase (`src/lib/worktree.ts`) — execFileSync usage pattern
- Existing codebase (`src/actions/git-actions.ts`) — server action pattern for git operations
- Existing codebase (`src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx`) — integration point, existing structure
- `.planning/phases/20-file-tree-browser/20-CONTEXT.md` — all locked decisions
- `.planning/phases/20-file-tree-browser/20-UI-SPEC.md` — component inventory, styling spec
- `.planning/STATE.md` — accumulated project decisions
- `node_modules/.pnpm/ignore@7.0.5/node_modules/ignore/index.d.ts` — TypeScript API for ignore package

### Secondary (MEDIUM confidence)

- `pnpm-lock.yaml` — confirmed `ignore@7.0.5` is in virtual store as transitive dep
- `package.json` — confirmed `ignore` is NOT a direct dependency (must add)
- `vitest.config.ts` — confirmed test infrastructure and patterns

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps verified against package.json and node_modules
- Architecture: HIGH — locked in CONTEXT.md; patterns mirror existing codebase exactly
- Pitfalls: HIGH — derived from code inspection (execSync→execFileSync security fix, ignore package not direct dep)
- Testing: HIGH — test infrastructure fully inspected

**Research date:** 2026-03-31
**Valid until:** 2026-05-01 (stable domain; `ignore` package API stable across majors)
