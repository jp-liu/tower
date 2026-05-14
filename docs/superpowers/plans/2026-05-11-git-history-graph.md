# Git History Graph (v1.3.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Milestone:** v1.3.1 (patch on top of v1.3 — adds a self-contained Git history graph feature)
**Date:** 2026-05-11
**Module(s):** `task`, `git`, `i18n`

**Goal:** Render a `git log --all --graph` style visual commit graph as a new "Graph" sub-tab in the task detail page's left panel, with: SVG-rendered lanes + dots + edges, hover tooltip per commit showing full metadata, click commit to expand a files-changed panel, click file to open a read-only commit diff tab in the main editor area (right side).

**Architecture:** Three layers. (1) Server: extend `/api/git` with `log-graph` (returns commits with parents, refs, author, date, subject) and `show-commit` (returns the unified patch for a commit). (2) Lane algorithm + SVG rendering: a small in-house implementation (no third-party library; `@gitgraph/react` is archived). Pure functions for layout, plus a React component for rendering. (3) UI integration: new `Graph` sub-tab next to Files/Search/Git, click-commit reveals files panel inline, click-file pushes a `commitDiffRequest` up to `CodeEditor` which renders a new commit-diff tab type using the existing `<DiffView>` (from v1.3 Phase 2).

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · `simple-git` (already installed) · `parse-diff` + `@git-diff-view/react` (already installed from v1.3) · pure SVG (no chart library) · Vitest + RTL · Tailwind 4 / shadcn.

---

## Scope Note (per writing-plans guidance)

This plan covers **6 phases / 11 tasks**, intended as one shippable v1.3.1 patch. Each phase ends in a working state; partial completion is shippable.

| Phase | Scope | Estimate |
|-------|-------|----------|
| 1 | Server APIs (`log-graph` + `show-commit`) | 0.5 day |
| 2 | Lane algorithm (pure function, fully tested) | 0.5 day |
| 3 | SVG rendering + hover tooltip | 0.5 day |
| 4 | Commit list + files-changed panel | 0.5 day |
| 5 | New `Graph` sub-tab + commit-diff tab in CodeEditor | 0.5 day |
| 6 | Commit context menu (`⋯` button + right-click): checkout / reset / tag / cherry-pick / revert / amend-message / copy-hash | 1 day |

**Total ≈ 3.5 days.** Recommended execution: linear phase-by-phase. Phases 1–5 ship a viewable graph; Phase 6 makes it interactive.

---

## Files Created / Modified

**Created**

- `src/lib/git-graph-layout.ts` — pure lane assignment + edge computation. Input: `RawCommit[]`. Output: `LaidOutCommit[]` (each commit gets `lane`, `row`, `color`) + `Edge[]` (parent → child connections, including bend points for cross-lane).
- `src/lib/__tests__/git-graph-layout.test.ts` — fixture-driven unit tests covering: linear chain, single branch+merge, criss-cross (two parallel branches merging back), octopus merge (3+ parents), orphan root, lane recycling.
- `src/components/task/git-graph-svg.tsx` — `"use client"` SVG renderer. Inputs: layout result + `selectedCommitHash` + `onCommitClick`. Renders circles per commit, lines per edge. Hover triggers tooltip overlay showing full commit message + author + ISO date + parent SHAs.
- `src/components/task/__tests__/git-graph-svg.test.tsx` — render fixture layout, assert circles count, click commit fires callback, hover shows tooltip text.
- `src/components/task/git-history-panel.tsx` — wrapper that owns: data fetch via `gitAction("log-graph")`, selected commit state, files panel (fetches `show-commit` lazily). Lays out as: graph SVG on the left (~140px), commit list in the middle (subject · short hash · author · relative time + `⋯` action button), files-changed panel slides in below when a commit is selected.
- `src/components/task/__tests__/git-history-panel.test.tsx` — RTL: mock `gitAction`; assert initial graph renders; click commit reveals files; click file fires `onSelectCommitFile`.
- `src/components/task/commit-action-menu.tsx` — `<DropdownMenu>` component that renders the commit context menu. Used both by the `⋯` button on each commit row AND by native right-click (`onContextMenu`). Items: Checkout, Create branch from here, Create tag, Cherry-pick, Revert, Reset (sub-menu: soft/mixed/hard), Amend message (HEAD-only, disabled otherwise), Copy hash, Copy short hash.
- `src/components/task/__tests__/commit-action-menu.test.tsx` — RTL: mock `gitAction`; assert each menu item dispatches the right action with the right body; assert Amend Message is disabled when `commit.hash !== currentHead`; assert hard-reset shows confirm dialog.
- `src/components/task/commit-tag-dialog.tsx` — small `<Dialog>` for creating an annotated tag: name input + optional message textarea + submit. Used by the "Create tag" menu item.
- `src/components/task/commit-message-dialog.tsx` — small `<Dialog>` for editing the HEAD commit message (amend). Single textarea pre-filled with current message. Used by "Amend message".

**Modified**

- `src/app/api/git/route.ts` — add `case "log-graph"`, `case "show-commit"`, plus the Phase 6 commit-op cases: `case "checkout-commit"`, `case "reset-commit"`, `case "create-tag"`, `case "cherry-pick"`, `case "revert"`, `case "amend-message"`.
- `src/app/api/git/__tests__/route.test.ts` — integration tests for the new actions against a real temp git repo with a branch+merge fixture. Each commit-op case gets at least one happy-path test against a clean working tree.
- `src/components/task/editor-tabs.tsx` — extend `EditorTab` interface with optional `isCommitDiff?: boolean`, `commitHash?: string`, `patch?: string`. Visual: show `History` icon (lucide) prefix and ` · <hash[0..7]>` suffix for commit-diff tabs (distinct from working-tree diff tabs which use `GitCompare` + `(diff)` suffix).
- `src/components/task/code-editor.tsx` — accept a new prop `commitDiffRequest?: { commitHash, relativePath, patch } | null`. New `useEffect` that reacts to it, opening a commit-diff tab (`path = "commit:${hash}:${relativePath}"`). New rendering branch: when `activeTab.isCommitDiff`, render `<DiffView patch={activeTab.patch!} language={detectLanguage(activeTab.filename)} />` (read-only — no `onStageHunk` / `onDiscardHunk` for commit-diff tabs).
- `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx` — add fourth `<TabsTrigger value="graph">` and `<TabsContent value="graph">` mirroring the existing Files/Search/Git pattern. New state `commitDiffRequest` and handler. Pass through to `<CodeEditor>`.
- `src/lib/i18n/zh.ts` and `src/lib/i18n/en.ts` — keys: `git.tabGraph`, `git.noCommits`, `git.commitFiles`, `git.commitDiff`, `git.hoverHashLabel`, `git.hoverAuthorLabel`, `git.hoverDateLabel`, `git.hoverParentsLabel`, `git.hoverRefsLabel`, plus commit-op keys: `git.commitMenuCheckout`, `git.commitMenuCreateBranch`, `git.commitMenuCreateTag`, `git.commitMenuCherryPick`, `git.commitMenuRevert`, `git.commitMenuReset`, `git.commitMenuResetSoft`, `git.commitMenuResetMixed`, `git.commitMenuResetHard`, `git.commitMenuAmend`, `git.commitMenuCopyHash`, `git.commitMenuCopyShort`, `git.commitResetHardConfirm`, `git.tagNamePlaceholder`, `git.tagMessagePlaceholder`, `git.amendMessageDialogTitle`.

**Untouched (deliberately)**

- `src/lib/git-diff.ts` — already has the parser; nothing new needed
- `src/components/task/diff-view.tsx` — reused as-is for commit-diff rendering
- `src/components/task/file-history-panel.tsx` — separate feature (per-file log); leave alone
- `src/components/task/blame-overlay.tsx` — separate feature; leave alone
- `src/components/task/editor-git-panel.tsx` — Git operations panel; unrelated

---

## Test Strategy

- **Unit:** `git-graph-layout.ts` with 6+ fixture cases; lane recycling is the trickiest invariant to test
- **Component (RTL):** `GitGraphSvg` renders correct DOM (circle count, line count) for a given layout; hover tooltip; click handler
- **Integration:** `/api/git` `log-graph` + `show-commit` against a real temp repo with: 1 root, 2 branches diverging, 1 merge commit. Verify shape end-to-end
- **Manual smoke:** open task detail → Graph tab loads in <500ms for the repo's last 200 commits; click commit → files appear; click file → diff tab opens in main editor; hover → tooltip shows; close diff tab → graph survives

---

## Data Shapes (referenced throughout)

```typescript
// Server output for log-graph
interface RawCommit {
  hash: string;       // full SHA
  shortHash: string;  // 7-char
  parents: string[];  // full SHAs of parents (0=root, 1=normal, 2=merge, 3+=octopus)
  author: string;     // %an
  date: string;       // %aI (ISO 8601)
  subject: string;    // %s (first line)
  refs: string[];     // branch/tag names attached (parsed from %D)
}

// Layout output
interface LaidOutCommit extends RawCommit {
  lane: number;       // 0-indexed column
  row: number;        // 0-indexed row (top = newest)
  color: string;      // hex per lane, cycling through palette
}

interface Edge {
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
  color: string;
}

interface GraphLayout {
  commits: LaidOutCommit[];
  edges: Edge[];
  laneCount: number;
}
```

---

## Phase 1: Server APIs

Goal: data ready for the client. Two new POST actions, both pure read.

### Task 1: `log-graph` action

**Files:**
- Modify: `src/app/api/git/route.ts`
- Modify: `src/app/api/git/__tests__/route.test.ts`

**Spec:**

```typescript
case "log-graph": {
  const rawLimit = parseInt(body.limit ?? "200", 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 200;
  try {
    // Format: hash | parents (space-sep) | author | date | refs | subject
    // Subject may contain pipes — put it last and don't split it.
    const SEP = "\x1f"; // ASCII unit separator, safe vs commit subjects
    const raw = await git.raw([
      "log", "--all",
      `--max-count=${limit}`,
      `--format=%H${SEP}%P${SEP}%an${SEP}%aI${SEP}%D${SEP}%s`,
    ]);
    const lines = raw.split("\n").filter((l) => l.length > 0);
    const commits = lines.map((line) => {
      const [hash, parentsStr, author, date, refsStr, subject] = line.split(SEP);
      const parents = parentsStr ? parentsStr.split(" ").filter(Boolean) : [];
      // %D yields e.g. "HEAD -> main, origin/main, tag: v1.0"
      const refs = refsStr
        ? refsStr.split(",").map((r) => r.trim().replace(/^HEAD -> /, "").replace(/^tag: /, "")).filter(Boolean)
        : [];
      return {
        hash,
        shortHash: hash.slice(0, 7),
        parents,
        author: author ?? "",
        date: date ?? "",
        subject: subject ?? "",
        refs,
      };
    });
    let head: string | null = null;
    try { head = (await git.revparse(["HEAD"])).trim(); } catch { /* detached or empty repo */ }
    return NextResponse.json({ commits, head });
  } catch {
    return NextResponse.json({ commits: [], head: null });
  }
}
```

**Response shape:** `{ commits: RawCommit[], head: string | null }` — `head` is the current HEAD SHA (used in Phase 6 to enable/disable "Amend message" per commit).

- [ ] **Step 1: Write failing integration test**

  In `src/app/api/git/__tests__/route.test.ts`, add a new `describe("log-graph", ...)` block that:
  - Creates a temp repo (`fs.mkdtempSync` + `simpleGit().init()`)
  - Commits A on `main`
  - Creates branch `feat`, commits B
  - Switches back to `main`, commits C
  - Merges `feat` into `main` → commit D (has 2 parents)
  - Calls POST with `{ action: "log-graph", path: repoPath }`
  - Asserts response.commits has length 4 (A, B, C, D in some topo order)
  - Asserts merge commit D has 2 parents
  - Asserts each commit has the documented shape (hash 40 chars, shortHash 7, parents array, author non-empty)
  - Asserts `head` is the SHA of the current HEAD commit (the latest one on `main`)

- [ ] **Step 2: Run — verify FAIL**

  ```bash
  pnpm test src/app/api/git/__tests__/route.test.ts -- --run -t "log-graph"
  ```

  Expected: 400 "Unknown action" from current router.

- [ ] **Step 3: Implement the case**

  Insert into the `switch (action)` block in `route.ts`. Paste the spec code above. The ASCII unit separator (`\x1f`) is the right choice for `--format` field separation — git's `%s` (subject) is allowed to contain `|`, `:`, etc., but never `\x1f`.

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/api/git/route.ts src/app/api/git/__tests__/route.test.ts
  git commit -m "feat(api/git): log-graph action for cross-branch commit history"
  ```

### Task 2: `show-commit` action

**Files:**
- Modify: `src/app/api/git/route.ts`
- Modify: `src/app/api/git/__tests__/route.test.ts`

**Spec:**

```typescript
case "show-commit": {
  const { hash } = body;
  if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
    return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
  }
  try {
    // Get the patch with diff for all files in this commit (vs first parent).
    // For a merge: shows changes vs first parent. For a root: shows full file content as +.
    const patch = await git.show([hash, "--format="]);
    // Per-file breakdown via parse-diff (already a dep, used in DiffView).
    const { parseUnifiedDiff } = await import("@/lib/git-diff");
    const parsed = parseUnifiedDiff(patch);
    const files = parsed.map((f) => {
      const filename = f.to && f.to !== "/dev/null" ? f.to : (f.from ?? "");
      let added = 0;
      let removed = 0;
      let isBinary = false;
      for (const chunk of f.chunks) {
        for (const c of chunk.changes) {
          if (c.type === "add") added++;
          else if (c.type === "del") removed++;
        }
      }
      // Build a per-file patch substring (header + that file's chunks)
      // Easier approach: re-stringify from parse-diff output.
      // But for simplicity, we send the FULL patch + filenames; the client
      // can locate the per-file slice via the `diff --git a/<file>` markers.
      return { filename, added, removed, isBinary, patch: "" };
    });
    return NextResponse.json({ patch: patch.replace(/\r\n/g, "\n"), files });
  } catch {
    return NextResponse.json({ error: "commit not found or unreadable" }, { status: 404 });
  }
}
```

**Important:** the `files[].patch` field is intentionally empty in the response — clients should slice the full patch by `diff --git a/<filename>` markers (cheap on the client, avoids re-stringification on the server). Document this in a comment.

- [ ] **Step 1: Write failing integration test**

  Extend the temp-repo fixture from Task 1 with a commit that modifies 2 distinct files. Call `show-commit` with that commit's hash. Assert:
  - `response.patch` contains `diff --git` for both files
  - `response.files.length === 2`
  - Each file has the right `added`/`removed` counts
  - Invalid hash (`"zzz"`) → 400

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement**

  Insert into the `switch (action)` block. Note: the dynamic import of `@/lib/git-diff` works in App Router but check that `parseUnifiedDiff` is also importable statically — if so, hoist to top of file.

  Actually: `parseUnifiedDiff` is exported from `@/lib/git-diff` and is pure. Hoist to module-level import.

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/api/git/route.ts src/app/api/git/__tests__/route.test.ts
  git commit -m "feat(api/git): show-commit action for per-commit file list + patch"
  ```

### Phase 1 Checkpoint

- [ ] `pnpm test src/app/api/git/__tests__/route.test.ts -- --run` — all pass
- [ ] Empty marker: `git commit --allow-empty -m "chore(phase1): git-graph server APIs complete (T1/T2)"`

---

## Phase 2: Lane Algorithm

Goal: a pure function from `RawCommit[]` → `GraphLayout`. Fully unit-tested. No React.

### Task 3: `git-graph-layout.ts`

**Files:**
- Create: `src/lib/git-graph-layout.ts`
- Create: `src/lib/__tests__/git-graph-layout.test.ts`

**Algorithm (Smith-waterfall / Bonsai):**

```
Input: commits sorted newest-first (already topo-sorted by git log)
State: lanes[i] = hash of the child still waiting for this lane's commit (or null if free)

For each commit (in order):
  1. Find the lane that's waiting for this commit:
       wantedLane = lanes.findIndex((waitingChildHash) => waitingChildHash === commit.hash)
     If found: this commit lives in wantedLane. Mark lanes[wantedLane] = commit.parents[0] ?? null.
     If not found: this commit starts a new chain. Find first free lane (or push new).
                   lanes[freeLane] = commit.parents[0] ?? null.
  2. For each ADDITIONAL parent (merge): allocate (or reuse) a lane for it.
     For each parent[i] where i > 0: find a free lane or push new, set lanes[mergeLane] = parents[i].
  3. Commit's row = current index in iteration.
  4. Edges: for each parent, find the lane that will hold it after this commit is processed.
     Add edge { fromLane: commit.lane, fromRow: commit.row, toLane: parentLane, toRow: ???, color }.
     toRow is unknown until the parent is processed — defer to a second pass or store parent hash and resolve.
```

Simpler approach: **two-pass**.
- Pass 1: assign lanes, record commit positions in a Map<hash, {lane, row, color}>.
- Pass 2: for each commit, build edges to each parent using the Map.

Edges that span multiple rows render as straight vertical lines (if same lane) or diagonals/curves (if different lanes).

**Color palette:** rotate through a fixed list (e.g., 8 colors) keyed by `lane % palette.length`.

**Skeleton:**

```typescript
// src/lib/git-graph-layout.ts
export interface RawCommit {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  refs: string[];
}

export interface LaidOutCommit extends RawCommit {
  lane: number;
  row: number;
  color: string;
}

export interface Edge {
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
  color: string;
}

export interface GraphLayout {
  commits: LaidOutCommit[];
  edges: Edge[];
  laneCount: number;
}

const PALETTE = [
  "#3fb950", "#58a6ff", "#f78166", "#d2a8ff",
  "#ffa657", "#7ee787", "#79c0ff", "#ff7b72",
];
const colorFor = (lane: number) => PALETTE[lane % PALETTE.length];

export function layoutGraph(commits: RawCommit[]): GraphLayout {
  // lanes[i] holds the hash this lane is "waiting" to render (its parent)
  // Empty slot = null.
  const lanes: (string | null)[] = [];
  const positions = new Map<string, { lane: number; row: number; color: string }>();
  const laidOut: LaidOutCommit[] = [];

  function takeLane(predicate: (slot: string | null) => boolean): number {
    for (let i = 0; i < lanes.length; i++) {
      if (predicate(lanes[i])) return i;
    }
    lanes.push(null);
    return lanes.length - 1;
  }

  commits.forEach((commit, row) => {
    // Step 1: find the lane that was expecting THIS commit (lanes[i] === commit.hash)
    let lane = lanes.findIndex((slot) => slot === commit.hash);
    if (lane === -1) {
      // No one was waiting — take a free lane (null slot)
      lane = takeLane((slot) => slot === null);
    }
    // After processing: this lane now waits for the FIRST parent (or becomes free).
    lanes[lane] = commit.parents[0] ?? null;

    // For each ADDITIONAL parent (merge), allocate a lane.
    for (let i = 1; i < commit.parents.length; i++) {
      const parentHash = commit.parents[i];
      // Reuse a lane if it's already waiting for this parent (handles octopus).
      let parentLane = lanes.findIndex((slot) => slot === parentHash);
      if (parentLane === -1) {
        parentLane = takeLane((slot) => slot === null);
        lanes[parentLane] = parentHash;
      }
      // No edge stored here — Pass 2 will compute all edges using positions map.
    }

    const color = colorFor(lane);
    positions.set(commit.hash, { lane, row, color });
    laidOut.push({ ...commit, lane, row, color });
  });

  // Pass 2: build edges from each commit to its parents using positions map.
  const edges: Edge[] = [];
  for (const commit of laidOut) {
    for (const parentHash of commit.parents) {
      const parent = positions.get(parentHash);
      if (!parent) continue; // parent outside the windowed log range
      edges.push({
        fromLane: commit.lane,
        fromRow: commit.row,
        toLane: parent.lane,
        toRow: parent.row,
        color: commit.color, // edge inherits child's color (matches git/GitKraken convention)
      });
    }
  }

  return { commits: laidOut, edges, laneCount: lanes.length };
}
```

- [ ] **Step 1: Write failing tests (fixture-driven)**

  Create `src/lib/__tests__/git-graph-layout.test.ts`. Use synthetic `RawCommit[]` fixtures:

  **Fixture A: Linear (no branches)**
  ```typescript
  // C ← B ← A (newest first)
  const linear = [
    { hash: "C", shortHash: "C", parents: ["B"], author: "x", date: "", subject: "", refs: [] },
    { hash: "B", shortHash: "B", parents: ["A"], author: "x", date: "", subject: "", refs: [] },
    { hash: "A", shortHash: "A", parents: [],    author: "x", date: "", subject: "", refs: [] },
  ];
  ```
  Expected: all 3 commits on lane 0, 2 edges (C→B and B→A), `laneCount === 1`.

  **Fixture B: Branch + merge** — main has commits A → C → D (where D merges in side branch); side branch is A → B.
  - Commits in newest-first order: D (merge, parents `[C, B]`), C (parent `[A]`), B (parent `[A]`), A (root, parents `[]`).
  - Expected: D on lane 0 (where main lives), C on lane 0, B on lane 1, A on lane 0.
  - Edges: D→C (lane 0 vertical), D→B (lane 0 to lane 1), C→A (lane 0), B→A (lane 1 to lane 0).
  - `laneCount === 2`.

  **Fixture C: Lane recycling**
  - After a branch fully merges back, its lane should be reused for subsequent unrelated branches.
  - Commits: F (parent [E]), E (parent [D, B]) — merge, D (parent [C]), C (parent [A]), B (parent [A]), A (root).
  - Expected: D and B share lane 1 at different rows OR D uses lane 1 and B uses lane 1 after D resolves. (Implementation detail — verify your algorithm matches reality.)

  **Fixture D: Octopus merge** (3 parents)
  - X (parents [A, B, C]), then A, B, C as roots.
  - laneCount === 3.

  **Fixture E: Empty input** → `{ commits: [], edges: [], laneCount: 0 }`.

  **Fixture F: Parent outside window** — commit with parent hash not in the input → edge to that parent is omitted.

  Write at least 6 `it(...)` blocks, each asserting on a specific aspect (position of each commit, edge count, laneCount, color cycling).

- [ ] **Step 2: Run — verify FAIL**

  ```bash
  pnpm test src/lib/__tests__/git-graph-layout.test.ts -- --run
  ```

- [ ] **Step 3: Implement `git-graph-layout.ts`**

  Paste the skeleton above. Adjust if tests reveal off-by-ones.

- [ ] **Step 4: Run — verify PASS**

  If a test fails because of an algorithm choice (e.g., when 2 lanes are free which one to pick), adjust the test to match the deterministic behavior of your algorithm — don't hand-tune the algorithm to a non-load-bearing expectation.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/git-graph-layout.ts src/lib/__tests__/git-graph-layout.test.ts
  git commit -m "feat(git): lane assignment + edge layout for git history graph"
  ```

### Phase 2 Checkpoint

- [ ] `pnpm test src/lib/__tests__/git-graph-layout.test.ts -- --run` — all pass
- [ ] Empty marker: `git commit --allow-empty -m "chore(phase2): git-graph lane algorithm complete (T3)"`

---

## Phase 3: SVG Renderer

Goal: a presentational React component that takes the layout output and renders an SVG.

### Task 4: `<GitGraphSvg>` component + hover tooltip

**Files:**
- Create: `src/components/task/git-graph-svg.tsx`
- Create: `src/components/task/__tests__/git-graph-svg.test.tsx`

**Constants:**

```typescript
const LANE_WIDTH = 16;   // px between lanes
const ROW_HEIGHT = 24;   // px between rows
const DOT_RADIUS = 5;
const SVG_PADDING = 8;
```

**Props:**

```typescript
interface GitGraphSvgProps {
  layout: GraphLayout;
  selectedCommitHash?: string | null;
  onCommitClick?: (hash: string) => void;
}
```

**Rendering rules:**
- Width: `layout.laneCount * LANE_WIDTH + SVG_PADDING * 2`
- Height: `layout.commits.length * ROW_HEIGHT + SVG_PADDING * 2`
- For each `edge`: render a `<path>` from (fromLane, fromRow) to (toLane, toRow). If same lane → straight `M x1 y1 L x1 y2`. If different lane → diagonal/curved — use a simple bezier `M x1 y1 C x1 (y1+ROW_HEIGHT/2) x2 (y1+ROW_HEIGHT/2) x2 y2`.
- For each `commit`: render a `<circle cx cy r fill={color}>`. If `commit.hash === selectedCommitHash`, render an outer `stroke` halo (e.g., `r+3` ring with white stroke). `onClick` → `onCommitClick(commit.hash)`.
- For hover: track `hoveredCommit` state; on `onMouseEnter` of a commit's `<g>`, set hover; on `onMouseLeave`, clear. Render a `<foreignObject>` overlay near the hovered commit showing:
  - `<author>` (bold)
  - `<short hash>` (mono)
  - relative date (use the `formatBlameAge` from `blame-overlay.tsx`)
  - subject (full text, wrap if long)
  - refs (badges if any)
  - parents (mono)

**Tip:** `<foreignObject>` allows HTML inside SVG. Set `width=240 height=auto` and absolutely position based on the hovered commit's coordinates. Clamp to SVG bounds.

- [ ] **Step 1: Write failing test**

  Fixture: a 3-commit linear layout. Render `<GitGraphSvg layout={fixture} onCommitClick={spy} />`. Assert:
  - 3 `<circle>` elements present
  - At least 2 `<path>` elements (edges)
  - Click the middle circle → spy called with the middle commit's hash
  - Hover the first circle → tooltip appears with that commit's subject text visible

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement `GitGraphSvg`**

  Compose plain SVG. Use Tailwind for the tooltip wrapper (inside `<foreignObject>`). Constants module-level.

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/task/git-graph-svg.tsx src/components/task/__tests__/git-graph-svg.test.tsx
  git commit -m "feat(task): GitGraphSvg renders commits as SVG with hover tooltip"
  ```

### Phase 3 Checkpoint

- [ ] Tests green
- [ ] Empty marker: `git commit --allow-empty -m "chore(phase3): git-graph SVG renderer complete (T4)"`

---

## Phase 4: Commit List + Files Panel

Goal: a panel that shows the commit list next to the graph SVG, and reveals files-changed when a commit is selected.

### Task 5: `<GitHistoryPanel>`

**Files:**
- Create: `src/components/task/git-history-panel.tsx`
- Create: `src/components/task/__tests__/git-history-panel.test.tsx`

**Props:**

```typescript
interface GitHistoryPanelProps {
  worktreePath: string;
  onSelectCommitFile?: (commitHash: string, relativePath: string, patch: string) => void;
}
```

**State:**
- `commits: RawCommit[]` — loaded on mount via `gitAction("log-graph")`
- `selectedHash: string | null`
- `commitFiles: { filename, added, removed, isBinary }[]` — loaded when `selectedHash` changes via `gitAction("show-commit")`
- `commitPatch: string` — full patch from `show-commit`, kept to slice per-file

**Layout (left panel, ~240px wide overall):**

```
┌────────────────────────────────────┐
│ SVG (laneCount * 16px)             │ ← Graph column
│ │  COMMIT subject                  │
│ │  shortHash · author · 2d ago     │
│ │                                  │
│ │ × COMMIT subject (selected)      │
│ │   shortHash · author · 3d ago    │
│ │   ┌─ files ─────────────┐        │
│ │   │ M src/foo.ts +12 -3 │        │
│ │   │ A src/bar.ts        │        │
│ │   │ ...                  │        │
│ │   └─────────────────────┘        │
│ │  COMMIT ...                      │
└────────────────────────────────────┘
```

Implementation simplification: render the SVG and the commit list as two columns inside a single flex row. The SVG and list must share `ROW_HEIGHT` so commits visually align with their SVG dots.

**Per-file patch slicing helper:** when user clicks a file in the files list:

```typescript
function slicePerFilePatch(fullPatch: string, filename: string): string {
  // Find the "diff --git a/<filename>" or "diff --git b/<filename>" marker
  const markers = fullPatch.split(/^diff --git /m);
  for (let i = 1; i < markers.length; i++) {
    const chunk = "diff --git " + markers[i];
    // The first line of each chunk has the path
    const firstLine = chunk.split("\n")[0] ?? "";
    if (firstLine.includes(`a/${filename}`) || firstLine.includes(`b/${filename}`)) {
      return chunk;
    }
  }
  return "";
}
```

Then fire `onSelectCommitFile(selectedHash, filename, perFilePatch)`.

- [ ] **Step 1: Write failing tests**

  Mock `gitAction`:
  - `log-graph` → return a 3-commit fixture
  - `show-commit` (hash X) → return a 2-file patch

  Render `<GitHistoryPanel worktreePath="/x" onSelectCommitFile={spy} />`.

  Tests:
  - Initial: 3 commits visible in list (assert by subject text)
  - Click commit X → files panel reveals with 2 file rows
  - Click a file → spy called with `(X, filename, patch)` where patch contains `diff --git`
  - `git-graph-svg` mocked as a stub that exposes commit-click via a button per commit — keep this test fast

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement**

  Two columns in a flex row: SVG (use real `<GitGraphSvg>` — or mock if tests don't care about SVG details) + commit list (`<div>` per commit, `ROW_HEIGHT` per row, accent border on selected). Files panel renders inline below the selected commit row (taking extra height for that row).

  Render file rows with status icon (use existing `STATUS_ICON` / `STATUS_COLOR` / `STATUS_LETTER` maps from `editor-git-panel.tsx` — or duplicate the small map; don't refactor existing file).

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/task/git-history-panel.tsx src/components/task/__tests__/git-history-panel.test.tsx
  git commit -m "feat(task): GitHistoryPanel — graph + commit list + per-commit files"
  ```

### Phase 4 Checkpoint

- [ ] Tests green
- [ ] Empty marker: `git commit --allow-empty -m "chore(phase4): git-graph commit + files panel complete (T5)"`

---

## Phase 5: Integration — Graph Tab + Commit-Diff Tabs

Goal: stitch everything together. New left-panel sub-tab; click a file in the Graph view opens a commit-diff tab in the main editor area.

### Task 6: New commit-diff tab type in CodeEditor

**Files:**
- Modify: `src/components/task/editor-tabs.tsx`
- Modify: `src/components/task/code-editor.tsx`
- Modify: `src/components/task/__tests__/code-editor.test.tsx`

**Steps:**

1. Extend `EditorTab` interface:
   ```typescript
   export interface EditorTab {
     // ... existing fields
     isCommitDiff?: boolean;
     commitHash?: string;
     patch?: string;
   }
   ```

2. `EditorTabs` visual: for `tab.isCommitDiff` show `History` lucide icon (sky-400) and `· <shortHash>` suffix muted. Mutually exclusive with the existing `(diff)` suffix (commit-diff tabs are NOT working-tree diffs).

3. `CodeEditor` new prop:
   ```typescript
   commitDiffRequest?: {
     commitHash: string;
     relativePath: string;
     patch: string;
   } | null;
   ```

4. New `useEffect` reacting to `commitDiffRequest`:
   ```typescript
   useEffect(() => {
     if (!commitDiffRequest) return;
     const { commitHash, relativePath, patch } = commitDiffRequest;
     const tabKey = `commit:${commitHash}:${relativePath}`;
     const filename = relativePath.split("/").pop() ?? relativePath;
     const existing = tabs.find((t) => t.path === tabKey);
     if (existing) {
       setActiveTabPath(tabKey);
       return;
     }
     const newTab: EditorTab = {
       path: tabKey,
       relativePath,
       filename,
       content: "",
       isDirty: false,
       isCommitDiff: true,
       commitHash,
       patch,
     };
     setTabs((prev) => (prev.some((t) => t.path === tabKey) ? prev : [...prev, newTab]));
     setActiveTabPath(tabKey);
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [commitDiffRequest]);
   ```

5. New rendering branch in the JSX. Before the existing `activeTab?.isDiff` branch, add:
   ```tsx
   {tabs.length > 0 && activeTab?.isCommitDiff && (
     <div className="flex-1 min-h-0 overflow-auto">
       <ErrorBoundary>
         <DiffView
           patch={activeTab.patch ?? ""}
           language={detectLanguage(activeTab.filename)}
         />
       </ErrorBoundary>
     </div>
   )}
   ```
   Also update the MonacoEditor `hidden` condition to include `activeTab.isCommitDiff`.

6. Also skip commit-diff tabs in model-creation effect and gutter effect (similar to `isDiff` skip).

- [ ] **Step 1: Write failing test**

  Mock `DiffView` as a stub. Render `<CodeEditor>` with `commitDiffRequest={{ commitHash, relativePath, patch }}`. Assert a new tab opens. Assert the DiffView stub receives the patch. Assert clicking back to a regular tab (if present) doesn't lose the commit-diff tab.

- [ ] **Step 2: Run — verify FAIL**

- [ ] **Step 3: Implement (across the 3 files)**

  Order: `editor-tabs.tsx` interface first → `code-editor.tsx` plumbing → tests.

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/task/editor-tabs.tsx src/components/task/code-editor.tsx src/components/task/__tests__/code-editor.test.tsx
  git commit -m "feat(editor): commit-diff tab type for read-only commit patch viewing"
  ```

### Task 7: i18n keys + tab label for Graph

**Files:**
- Modify: `src/lib/i18n/zh.ts`, `src/lib/i18n/en.ts`

**Keys to add:**
- `git.tabGraph` — zh `"图"` / en `"Graph"` (3-char tab label for the inner tab strip)
- `git.noCommits` — zh `"暂无提交"` / en `"No commits"`
- `git.commitFiles` — zh `"提交文件"` / en `"Files in commit"`
- `git.commitDiff` — zh `"提交差异"` / en `"Commit diff"` (used as tab tooltip)
- `git.hoverHashLabel` — zh `"哈希"` / en `"Hash"`
- `git.hoverAuthorLabel` — zh `"作者"` / en `"Author"`
- `git.hoverDateLabel` — zh `"时间"` / en `"Date"`
- `git.hoverParentsLabel` — zh `"父提交"` / en `"Parents"`
- `git.hoverRefsLabel` — zh `"分支/标签"` / en `"Refs"`

- [ ] **Step 1: Add keys to both files**
- [ ] **Step 2: Commit**

  ```bash
  git add src/lib/i18n/zh.ts src/lib/i18n/en.ts
  git commit -m "i18n(git): keys for graph tab + commit hover tooltip"
  ```

### Task 8: Add `Graph` sub-tab in task-page-client.tsx

**Files:**
- Modify: `src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx`

**Steps:**

1. Import: `import { GitHistoryPanel } from "@/components/task/git-history-panel";`
2. Import the `Network` icon from `lucide-react` (or `GitFork`).
3. Add a 4th `<TabsTrigger value="graph">` to the sub-tab strip:
   ```tsx
   <TabsTrigger value="graph" className="flex-1 text-xs gap-1 ...">
     <Network className="h-3 w-3" />
     {t("git.tabGraph")}
   </TabsTrigger>
   ```
4. Add a 4th `<TabsContent value="graph">`:
   ```tsx
   <TabsContent value="graph" className="flex-1 min-h-0 overflow-hidden mt-0">
     <GitHistoryPanel
       worktreePath={fileRootPath ?? task.project?.localPath ?? ""}
       onSelectCommitFile={(commitHash, relativePath, patch) => {
         setCommitDiffRequest({ commitHash, relativePath, patch });
       }}
     />
   </TabsContent>
   ```
5. Add new state at the top of the component:
   ```typescript
   const [commitDiffRequest, setCommitDiffRequest] = useState<{
     commitHash: string;
     relativePath: string;
     patch: string;
   } | null>(null);
   ```
6. Pass `commitDiffRequest` into `<CodeEditor>`.

- [ ] **Step 1: Make the changes** (no new tests for the page wiring — manual smoke verifies)
- [ ] **Step 2: Manual smoke**
  ```bash
  pnpm dev
  ```
  Open task detail → click `Graph` sub-tab → graph loads → click a commit → files appear → click a file → diff tab opens in main editor → tab label shows `History icon + filename · shortHash` → hover commit dot → tooltip shows author / date / subject / parents
- [ ] **Step 3: Commit**

  ```bash
  git add src/app/workspaces/[workspaceId]/tasks/[taskId]/task-page-client.tsx
  git commit -m "feat(task): Graph sub-tab in detail page wires up commit-diff flow"
  ```

### Phase 5 Checkpoint

- [ ] All tests pass: `pnpm test:run`
- [ ] Empty marker: `git commit --allow-empty -m "chore(phase5): git history graph integration complete (T6/T7/T8)"`

---

## Phase 6: Commit Context Menu (`⋯` button + right-click)

Goal: each commit row in the graph panel exposes an action menu — Checkout, Create branch, Create tag, Cherry-pick, Revert, Reset (soft/mixed/hard), Amend message (HEAD-only), Copy hash. Same menu opens via the row's `⋯` button on hover AND via native right-click anywhere on the row.

**Reuses existing patterns:**
- `<DropdownMenu>` from shadcn (already used in `editor-git-panel.tsx` for the "more actions" menu)
- `gitAction(localPath, ...)` for server calls
- `toast` from `sonner` for success/error
- Existing `<CreateBranchDialog>` for "Create branch from here" (already used by EditorGitPanel)

**Safety rules for destructive ops:**
- `reset --hard` → confirm dialog with the commit's subject + "this discards all working changes since this commit" warning
- `cherry-pick` and `revert` → no confirm, but show a toast pointing to the resulting commit/conflict state
- `checkout` on a non-branch commit → server-side reject if working tree dirty; UI surfaces the error

### Task 9: Server-side commit op actions

**Files:**
- Modify: `src/app/api/git/route.ts`
- Modify: `src/app/api/git/__tests__/route.test.ts`

**Six new cases to add to the POST `switch (action)` block. All require a clean working tree where noted; reject 4xx with a clear error message otherwise. `hash` must match `/^[a-f0-9]{4,40}$/i` (validated like `show-commit`).**

```typescript
case "checkout-commit": {
  const { hash } = body;
  if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
    return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
  }
  try {
    // Detached HEAD checkout. Refuses if there are uncommitted local changes.
    await git.checkout([hash]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Checkout failed (uncommitted changes?)" },
      { status: 500 }
    );
  }
}

case "reset-commit": {
  const { hash, mode } = body;
  if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
    return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
  }
  const safeMode = mode === "soft" || mode === "mixed" || mode === "hard" ? mode : "mixed";
  try {
    await git.reset([`--${safeMode}`, hash]);
    return NextResponse.json({ success: true, mode: safeMode });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Reset failed" },
      { status: 500 }
    );
  }
}

case "create-tag": {
  const { hash, name, message } = body;
  if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
    return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "tag name required" }, { status: 400 });
  }
  // Tag names: alphanumeric + dash/dot/underscore/slash. No spaces, no shell metachars.
  const safeName = name.trim().replace(/[^a-zA-Z0-9_\-./]/g, "");
  if (!safeName) {
    return NextResponse.json({ error: "tag name invalid" }, { status: 400 });
  }
  try {
    if (typeof message === "string" && message.trim()) {
      await git.tag(["-a", safeName, hash, "-m", message.trim()]);
    } else {
      await git.tag([safeName, hash]);
    }
    return NextResponse.json({ success: true, name: safeName });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Tag creation failed" },
      { status: 500 }
    );
  }
}

case "cherry-pick": {
  const { hash } = body;
  if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
    return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
  }
  try {
    await git.raw(["cherry-pick", hash]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Cherry-pick failed (conflict?)" },
      { status: 500 }
    );
  }
}

case "revert": {
  const { hash } = body;
  if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
    return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
  }
  try {
    // --no-edit auto-fills "Revert <subject>" message
    await git.raw(["revert", "--no-edit", hash]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Revert failed (conflict?)" },
      { status: 500 }
    );
  }
}

case "amend-message": {
  const { message } = body;
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  try {
    // --no-edit gone; pass the new message via -m.
    // git commit --amend ALWAYS targets HEAD. Caller responsibility to ensure
    // this is invoked only when the selected commit IS the current HEAD.
    await git.commit(message.trim(), { "--amend": null });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || "Amend failed" },
      { status: 500 }
    );
  }
}
```

**Tests (extend existing temp-repo fixture):**

- `checkout-commit` on a known good hash → `git status` shows detached HEAD at that hash. Invalid hash → 400.
- `reset-commit` with `mode: "soft"` → HEAD moves but index + worktree preserved (verify via `git log -1 --format=%H` shows the target hash; `git diff --cached` shows the rolled-back changes still staged).
- `create-tag` with valid name → `git tag -l` lists it. Invalid name (contains `;`) → sanitized to safe form (verify the sanitized version exists, original doesn't).
- `cherry-pick` of a commit applied cleanly → new HEAD has the same subject + " (cherry picked from ...)" trailer (optional in some git configs; just check exit success + new commit count).
- `revert` → new commit with `"Revert "<subject>"` message.
- `amend-message` on HEAD → `git log -1 --format=%s` shows the new subject.

- [ ] **Step 1: Write failing tests for all 6 cases**

  In `src/app/api/git/__tests__/route.test.ts`, add a `describe("commit-ops", ...)` block. Each `it(...)` exercises one action against the temp repo. Total ~6 new tests.

- [ ] **Step 2: Run — verify FAIL**

  ```bash
  pnpm test src/app/api/git/__tests__/route.test.ts -- --run -t "commit-ops"
  ```

- [ ] **Step 3: Implement all 6 cases**

  Paste the spec code above into the `switch (action)` block. Order doesn't matter; for readability, group them after the existing `log-graph` / `show-commit` cases.

- [ ] **Step 4: Run — verify PASS**

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/api/git/route.ts src/app/api/git/__tests__/route.test.ts
  git commit -m "feat(api/git): commit-op actions — checkout / reset / tag / cherry-pick / revert / amend"
  ```

### Task 10: `<CommitActionMenu>` component

**Files:**
- Create: `src/components/task/commit-action-menu.tsx`
- Create: `src/components/task/__tests__/commit-action-menu.test.tsx`
- Create: `src/components/task/commit-tag-dialog.tsx`
- Create: `src/components/task/commit-message-dialog.tsx`

**`<CommitActionMenu>` props:**

```typescript
interface CommitActionMenuProps {
  worktreePath: string;
  commit: RawCommit;          // the commit this menu acts on
  currentHead: string | null; // hash of HEAD — used to enable/disable amend-message
  onActionComplete?: () => void; // refetch graph after success
  /** Render as either a controlled DropdownMenu (controlled `open` state) or
   *  uncontrolled (managed by Trigger). For right-click integration the
   *  parent passes controlled props; for the inline ⋯ button it's uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Position for context-menu mode (right-click). When provided, the menu
   *  opens at this absolute (x, y) instead of anchored to a trigger. */
  anchorPosition?: { x: number; y: number };
  /** Custom trigger element (e.g. the ⋯ Button). When omitted, no trigger
   *  is rendered (must be controlled with anchorPosition). */
  triggerElement?: React.ReactNode;
}
```

**Menu items (use shadcn `<DropdownMenu>`):**

```
─ Checkout
─ Create branch from here…
─ Create tag…
─────────────
─ Cherry-pick
─ Revert
─ Reset to here  ▶
    ─ Soft (keep index + worktree)
    ─ Mixed (keep worktree, reset index)
    ─ Hard (discard everything) — confirms first
─────────────
─ Amend message…  (disabled if commit.hash !== currentHead)
─────────────
─ Copy hash
─ Copy short hash
```

**Handlers (sketch — each one toasts on success/error and fires `onActionComplete` on success):**

```typescript
const safeAction = async (label: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    toast.success(label);
    onActionComplete?.();
    onOpenChange?.(false);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
};

const handleCheckout = () =>
  safeAction(t("git.commitMenuCheckout"), () =>
    gitAction(worktreePath, "checkout-commit", { hash: commit.hash })
  );

const handleResetSoft = () =>
  safeAction(t("git.commitMenuResetSoft"), () =>
    gitAction(worktreePath, "reset-commit", { hash: commit.hash, mode: "soft" })
  );
// ... mixed similar

const handleResetHard = () => {
  if (!confirm(t("git.commitResetHardConfirm").replace("{subject}", commit.subject))) return;
  safeAction(t("git.commitMenuResetHard"), () =>
    gitAction(worktreePath, "reset-commit", { hash: commit.hash, mode: "hard" })
  );
};

const handleCherryPick = () =>
  safeAction(t("git.commitMenuCherryPick"), () =>
    gitAction(worktreePath, "cherry-pick", { hash: commit.hash })
  );

const handleRevert = () =>
  safeAction(t("git.commitMenuRevert"), () =>
    gitAction(worktreePath, "revert", { hash: commit.hash })
  );

const handleCopy = (text: string) => {
  navigator.clipboard.writeText(text);
  toast.success(t("git.commitMenuCopyHash"));
  onOpenChange?.(false);
};
```

**Create-tag dialog** (separate component `commit-tag-dialog.tsx`):
- Inputs: `name` (required), `message` (optional, becomes annotated tag if non-empty)
- Submit: `gitAction(worktreePath, "create-tag", { hash, name, message })`
- Reuse `<Dialog>` from shadcn

**Amend-message dialog** (separate component `commit-message-dialog.tsx`):
- Inputs: textarea pre-filled with `commit.subject` (or the full message — see git log `%B` if you want body too; subject only is fine for v1.3.1)
- Submit: `gitAction(worktreePath, "amend-message", { message })`
- Only enabled when `commit.hash === currentHead`

**Right-click anchor** — when `anchorPosition` is provided, render the menu as:

```tsx
<DropdownMenu open={open} onOpenChange={onOpenChange}>
  <DropdownMenuTrigger style={{ position: "absolute", left: anchorPosition.x, top: anchorPosition.y, width: 0, height: 0 }} />
  <DropdownMenuContent>...</DropdownMenuContent>
</DropdownMenu>
```

A zero-size invisible trigger at the click position lets the dropdown position itself there.

- [ ] **Step 1: Add i18n keys** for all menu items + confirm + dialog titles (zh + en). Use the list from the "Modified" files section above.

- [ ] **Step 2: Write failing test** for `<CommitActionMenu>`:
  - Mock `gitAction` + `toast` + `navigator.clipboard.writeText`
  - Render with a known commit + `currentHead` set to a DIFFERENT hash
  - Click ⋯ trigger → menu visible
  - Click each menu item → assert the right `gitAction` call. For destructive Reset → confirm via `window.confirm` (vi.spyOn). For Tag → assert dialog opens (use a stub for the dialog). For Amend → assert disabled state.

- [ ] **Step 3: Run — verify FAIL**

  ```bash
  pnpm test src/components/task/__tests__/commit-action-menu.test.tsx -- --run
  ```

- [ ] **Step 4: Implement**

  Build the component using shadcn `DropdownMenu` + `DropdownMenuSub` for the Reset sub-menu. Implement the tag + amend dialogs as separate components in their own files.

- [ ] **Step 5: Run — verify PASS**

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/task/commit-action-menu.tsx src/components/task/commit-tag-dialog.tsx src/components/task/commit-message-dialog.tsx src/components/task/__tests__/commit-action-menu.test.tsx src/lib/i18n/zh.ts src/lib/i18n/en.ts
  git commit -m "feat(task): CommitActionMenu — checkout / reset / tag / cherry-pick / revert / amend / copy"
  ```

### Task 11: Wire `<CommitActionMenu>` into `<GitHistoryPanel>`

**Files:**
- Modify: `src/components/task/git-history-panel.tsx`
- Modify: `src/components/task/__tests__/git-history-panel.test.tsx`

**Steps:**

1. The panel loads `currentHead` once (parallel to `log-graph` — pick the first commit reachable from HEAD, OR add a `head` field to the `log-graph` response; the latter is cleaner. **Update Task 1's `log-graph` response to also include `head: string | null`** by running `git.revparse(["HEAD"]).catch(() => null)` server-side and including it).

2. Per commit row, hover-reveal a `⋯` icon button (lucide `MoreHorizontal`) on the right. Click opens `<CommitActionMenu>` anchored to the button.

3. Right-click anywhere on the commit row (`<div onContextMenu={(e) => { e.preventDefault(); setContextMenu({ hash, x: e.clientX, y: e.clientY }); }}>`) opens the menu at the cursor position via the `anchorPosition` prop.

4. Both flows pass `onActionComplete` that refetches the graph (so the visualization updates after checkout / reset / tag).

The `log-graph` response already includes the `head: string | null` field (added in Task 1). The panel consumes it directly.

- [ ] **Step 1: Update `GitHistoryPanel` to consume `head` + render `⋯` button + right-click handler**

  Add state: `const [contextMenu, setContextMenu] = useState<{ hash: string; x: number; y: number } | null>(null);`. On row hover, show the `⋯` button (use the existing `opacity-0 group-hover:opacity-100` pattern). On row right-click, set `contextMenu`. Render a single `<CommitActionMenu>` at the panel root keyed off `contextMenu` (so only one menu instance exists at a time).

- [ ] **Step 2: Update test** — render panel, simulate right-click on a row → menu appears; simulate `⋯` button click → menu appears; assert post-action `gitAction("log-graph")` refetch happens.

- [ ] **Step 3: Run — verify PASS**

- [ ] **Step 4: Manual smoke**

  ```bash
  pnpm dev
  ```

  - Right-click a commit → menu appears at cursor
  - `⋯` button on hover → menu appears anchored to button
  - Checkout → toast + graph refetch shows new HEAD
  - Create tag → dialog → submit → toast + new ref badge appears on the commit
  - Reset Hard → confirm dialog → on accept, working tree wiped (verify with `git status` in terminal)

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/task/git-history-panel.tsx src/components/task/__tests__/git-history-panel.test.tsx
  git commit -m "feat(task): wire CommitActionMenu (⋯ + right-click) into git history panel"
  ```

### Phase 6 Checkpoint

- [ ] All tests pass: `pnpm test:run`
- [ ] Empty marker: `git commit --allow-empty -m "chore(phase6): commit context menu complete (T9/T10/T11)"`

---

## Final Verification

- [ ] All tests pass
- [ ] `pnpm tsc --noEmit` — no new errors in touched files
- [ ] Manual smoke on a real repo with > 50 commits and at least 2 branches with a merge:
  - Graph renders within 500ms
  - Hover tooltip is readable
  - Click commit reveals files; click file opens commit-diff tab on the right
  - Switching back and forth between commit-diff tab, regular tab, working-tree diff tab — no errors
  - `⋯` button on commit row + right-click open the same action menu
  - Each commit op (checkout / reset soft+mixed / tag / cherry-pick / revert / amend) succeeds against a clean working tree
  - Reset HARD shows confirm dialog before destruction
  - Amend Message is disabled on non-HEAD commits, enabled on HEAD
- [ ] Update `.planning/ROADMAP.md` with v1.3.1 entry

---

## Risks & Open Questions

1. **Lane algorithm corner cases** — octopus merges (3+ parents) and very deep histories can produce wide graphs. The 200-commit default limit keeps `laneCount` reasonable (usually < 8). If a real repo blows past 10 lanes, the SVG will scroll horizontally. Acceptable; document as a limit.

2. **Hover tooltip clipping** — when hovering a commit near the right edge, the tooltip may extend past the panel. Mitigation: detect bounds and flip the tooltip to the left side. Defer to a follow-up if not noticed in smoke testing.

3. **Date sorting vs topological order** — git's `--all` log uses `--date-order` by default. If commits are interleaved (e.g., merge from a branch whose commits are older), the visual could be confusing. If users complain, switch to `--topo-order` in the server.

4. **`show-commit` for root commit** — `git show <root>` produces a patch with `/dev/null` on the `from` side for every file. `parseUnifiedDiff` handles this (already verified in v1.3 P2-T4). No special case.

5. **Cancellation** — both the `log-graph` initial fetch AND the `show-commit` per-commit fetch can race against tab switches or rapid commit clicking. Apply the `let cancelled = false; return () => { cancelled = true; };` cleanup pattern (already used in `FileHistoryPanel`) to BOTH effects in `GitHistoryPanel`. Otherwise stale `setState` calls fire on unmounted components.

6. **Large patches via `show-commit`** — a single commit with 100+ files produces a multi-MB patch. The full patch goes over the wire. If this becomes a problem, switch to lazy per-file fetch (`show-commit-file` action returning one file's patch). Defer.

7. **Destructive commit ops on shared branches** — `reset --hard`, `amend-message`, and `revert` on commits that have been pushed to a remote can cause history divergence. We surface the warning in the confirm dialog text for hard reset, but no extra guard on amend (rewriting pushed HEAD). Acceptable since the user is operating on their own worktree branch in this app's typical usage. If shared-branch usage becomes common, add a "this commit has been pushed" badge from `git branch -r --contains <hash>` and require an extra checkbox to proceed.

8. **Commit ops on a dirty working tree** — `checkout-commit`, `cherry-pick`, `revert` all fail if there are uncommitted local changes; git's own error message bubbles up via the catch. The UI shows it via `toast.error`. No special handling beyond surfacing the error.

9. **`amend-message` only works on HEAD** — we disable the menu item for non-HEAD commits (the simple path). Supporting amend of arbitrary commits would require `git rebase -i` + interactive editor coordination, which is out of scope. Documented in the disabled menu item tooltip.
