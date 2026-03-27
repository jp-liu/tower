# Phase 5: MCP Knowledge Tools - Research

**Researched:** 2026-03-27
**Domain:** MCP action-dispatch tools, fuzzy project matching, note/asset CRUD via MCP
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from STATE.md Decisions)

### Locked Decisions
- MCP tools use action-dispatch pattern (`manage_notes`, `manage_assets`) to keep total tool count at or below 30
- `file-utils.ts` and `fts.ts` must never import Next.js modules — they are shared between Next.js and MCP stdio processes
- FTS5 virtual tables must be created via raw SQL AFTER `prisma db push` — never before, or Prisma detects schema drift
- Both PrismaClient instances (Next.js + MCP) need `PRAGMA busy_timeout=5000` to prevent "database is locked" errors
- `fts.ts` uses dependency injection (PrismaClient parameter) so it works in both Next.js and MCP stdio without Next.js imports
- FTS5 sync uses delete-then-insert pattern since FTS5 does not support UPDATE

### Claude's Discretion
- Exact confidence score algorithm for `identify_project` (thresholds, weighting formula)
- Whether to split `manage_notes` into 1 or 2 plans
- Test strategy for MCP tools (integration vs. unit with mocked db)

### Deferred Ideas (OUT OF SCOPE)
- File serving via HTTP (Phase 6)
- Notes and Assets Web UI (Phase 7)
- Cross-project global search (SRCH-01)
- Note tag system (SRCH-02)
- Note version history (COLLAB-01)
- Note templates (COLLAB-02)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROJ-01 | Users can find a project by name, alias, or description fuzzy match | SQLite LIKE + Levenshtein/score; see Fuzzy Match section |
| PROJ-02 | Search results ranked by field weight: name > alias > description | Scoring formula documented below |
| PROJ-03 | MCP provides `identify_project` tool returning matched project + confidence score | Tool design section |
| NOTE-04 | MCP provides `manage_notes` action-dispatch tool for note CRUD | Action-dispatch pattern; reuses `fts.ts` and `db` from MCP |
| ASST-03 | MCP provides asset upload tool that `mv`s external file into `data/assets/{projectId}/` | Uses `fs.renameSync` + `file-utils.ts`; no Next.js imports needed |
</phase_requirements>

---

## Summary

Phase 5 adds three new MCP tools (`identify_project`, `manage_notes`, `manage_assets`) to an existing server that already has 18 registered tools. The constraint is a hard ceiling of 30 total tools, leaving exactly 12 slots — so the action-dispatch pattern is mandatory to avoid adding one tool per CRUD operation.

All the infrastructure needed is already built in Phase 4: `fts.ts` (dependency-injected FTS5 search), `file-utils.ts` (directory helpers with no Next.js imports), `note-actions.ts` and `asset-actions.ts` (Prisma CRUD). The MCP tools in Phase 5 cannot import these server actions directly because they carry `"use server"` and Next.js runtime imports. Instead, MCP tools must call Prisma and the lib helpers directly, mirroring what the server actions do.

**Primary recommendation:** For each new MCP tool, copy the business logic from the corresponding server action but replace the `db` import with `src/mcp/db.ts` and omit all `revalidatePath` calls and `"use server"` directives.

---

## Standard Stack

### Core (already installed — no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.28.0 | MCP server + tool registration | Already in use |
| `zod` | ^4.3.6 | Input validation at MCP boundaries | Already in use; same pattern as existing tools |
| `@prisma/client` | (project version) | Database access | Already in use in `src/mcp/db.ts` |
| `node:fs` | built-in | File move (`renameSync`) for `manage_assets` | Already in `file-utils.ts` |
| `node:path` | built-in | Path construction | Already in `file-utils.ts` |

### No New Packages Required

All dependencies are already installed. Phase 5 is purely additive — new `.ts` files and registrations in `server.ts`.

---

## Architecture Patterns

### Recommended Project Structure

```
src/mcp/tools/
├── workspace-tools.ts    (existing)
├── project-tools.ts      (existing)
├── task-tools.ts         (existing)
├── label-tools.ts        (existing)
├── search-tools.ts       (existing)
├── knowledge-tools.ts    (NEW — identify_project)
└── note-asset-tools.ts   (NEW — manage_notes, manage_assets)
```

Two new tool files keep changes atomic and reviewable. Both get spread into `allTools` in `server.ts` the same way existing tools do.

### Pattern 1: Action-Dispatch Tool

**What:** A single MCP tool with an `action` enum field that routes to sub-handlers internally.

**When to use:** Any CRUD surface where registering 4-5 separate tools would push the count above 30.

**Example (from existing project pattern):**

```typescript
// src/mcp/tools/note-asset-tools.ts — NO "use server", NO next/cache imports
import { z } from "zod";
import { db } from "../db";
import { searchNotes, syncNoteToFts, deleteNoteFromFts } from "@/lib/fts";

export const manageNotesSchema = z.object({
  action: z.enum(["create", "update", "delete", "get", "list", "search"]),
  projectId: z.string().optional(),
  noteId: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  category: z.string().optional(),
  query: z.string().optional(),
});

export const noteAssetTools = {
  manage_notes: {
    description: "Create, read, update, delete, or search notes for a project.",
    schema: manageNotesSchema,
    handler: async (args: z.infer<typeof manageNotesSchema>) => {
      switch (args.action) {
        case "create": { /* ... */ }
        case "search": { /* calls searchNotes(db, ...) */ }
        // ...
      }
    },
  },
};
```

Key points:
- The `db` import is `"../db"` (MCP db), NOT `"@/lib/db"` (Next.js db)
- No `revalidatePath` — not available in MCP stdio process
- The `fts.ts` functions are safe to import because they use dependency injection (no Next.js imports)
- `file-utils.ts` is safe to import for the same reason

### Pattern 2: identify_project with Scored Matching

**What:** Query all projects matching the search term, score each result, return sorted array with confidence.

**When to use:** PROJ-01, PROJ-02, PROJ-03.

**Algorithm:**

```
score(project, query):
  normalized_query = query.toLowerCase().trim()

  name_score:
    exact match → 1.0
    starts-with match → 0.9
    contains match → 0.75
    no match → 0.0

  alias_score:
    exact match → 0.85
    starts-with → 0.75
    contains → 0.6
    no match → 0.0

  description_score:
    contains match → 0.4
    no match → 0.0

  final_score = max(name_score, alias_score, description_score)

  return { project, confidence: final_score }
  filter out confidence < 0.3
  sort by confidence DESC
```

This satisfies PROJ-02 (name > alias > description weight) because the scoring constants enforce hierarchy.

**Concern flagged in STATE.md:** The 0.85 alias threshold needs real-world validation. The planner should include a note that the exact thresholds may need tuning.

**Implementation approach (SQLite-first, no external library):**

```typescript
// src/mcp/tools/knowledge-tools.ts
export const knowledgeTools = {
  identify_project: {
    description: "Find a project by partial name, alias, or description. Returns matches sorted by confidence score (0–1).",
    schema: z.object({
      query: z.string().describe("Partial project name, alias, or description to search for"),
      workspaceId: z.string().optional().describe("Restrict search to a specific workspace"),
    }),
    handler: async (args: { query: string; workspaceId?: string }) => {
      const q = args.query.trim().toLowerCase();
      if (!q) return [];

      const projects = await db.project.findMany({
        where: {
          ...(args.workspaceId ? { workspaceId: args.workspaceId } : {}),
          OR: [
            { name: { contains: args.query, mode: "insensitive" } },
            { alias: { contains: args.query, mode: "insensitive" } },
            { description: { contains: args.query, mode: "insensitive" } },
          ],
        },
        include: { workspace: true },
      });

      // Score and sort
      const scored = projects
        .map(p => ({ project: p, confidence: scoreProject(p, q) }))
        .filter(r => r.confidence >= 0.3)
        .sort((a, b) => b.confidence - a.confidence);

      return scored.map(r => ({
        projectId: r.project.id,
        name: r.project.name,
        alias: r.project.alias,
        workspaceId: r.project.workspaceId,
        workspaceName: r.project.workspace.name,
        confidence: r.confidence,
      }));
    },
  },
};
```

Note: Prisma SQLite does NOT support `mode: "insensitive"` — use raw SQL or post-filter in JS. The `contains` without mode is case-sensitive in SQLite. Use `{ contains: q }` where `q` is already lowercased, OR use a broad `$queryRaw` with `LIKE '%?%'` and do scoring in JS.

**Recommended approach:** Fetch all projects in the workspace (or all if no workspaceId), do JS-level scoring. This is safe given the expected data volume (< 1000 projects) and avoids SQLite case-sensitivity issues.

### Pattern 3: manage_assets with File Move

**What:** Move an external file (provided by the AI agent as an absolute path) into `data/assets/{projectId}/`.

**Implementation:**

```typescript
case "add": {
  // args: { projectId, sourcePath, filename? }
  const assetsDir = ensureAssetsDir(args.projectId);
  const filename = args.filename ?? path.basename(args.sourcePath);
  const destPath = path.join(assetsDir, filename);

  // mv semantics — source file must exist
  fs.renameSync(args.sourcePath, destPath);

  const stats = fs.statSync(destPath);
  const asset = await db.projectAsset.create({
    data: {
      filename,
      path: destPath,
      size: stats.size,
      projectId: args.projectId,
    },
  });
  return asset;
}
```

Key constraint: `fs.renameSync` only works when source and destination are on the same filesystem. If source is on a different volume, it throws `EXDEV: cross-device link not found`. The planner should handle this with a copy+delete fallback:

```typescript
try {
  fs.renameSync(src, dest);
} catch (e: unknown) {
  if ((e as NodeJS.ErrnoException).code === "EXDEV") {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  } else throw e;
}
```

### Anti-Patterns to Avoid

- **Importing from `src/actions/*.ts` in MCP tools:** Server actions have `"use server"` and `revalidatePath` which crash in the MCP stdio process. Always copy the business logic and use `../db` directly.
- **Using Prisma `mode: "insensitive"` with SQLite:** SQLite doesn't support it. Use JS-level lowercasing and `contains` without mode, or use raw LIKE queries.
- **Registering more than 3 new tools:** Current count is 18. Adding `identify_project`, `manage_notes`, `manage_assets` = 21. The ceiling is 30. Adding individual CRUD tools (create_note, update_note, delete_note, etc.) would be 18 + 6+ = 24+, still under 30 but violates the locked action-dispatch decision.
- **Calling `revalidatePath` from MCP context:** Will throw — Next.js cache invalidation is not available outside the Next.js runtime.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Input validation | Custom validators | `zod` (already used) | Consistent with all other MCP tools |
| FTS search | Duplicate search logic | `fts.ts` functions (dependency-injected) | Already battle-tested, handles Chinese trigrams |
| Directory creation | Custom mkdir | `ensureAssetsDir` from `file-utils.ts` | Already tested, handles recursive creation |
| DB access in MCP | Second Prisma setup | `../db` (src/mcp/db.ts) | Already has WAL + busy_timeout set |
| Fuzzy string scoring | External library (fuse.js, etc.) | JS-level string comparison | No new package needed; data volume is small; avoids dependency |

**Key insight:** Every infrastructure primitive needed in Phase 5 was intentionally built for reuse in Phase 4. The MCP tools are thin wrappers around existing library functions.

---

## Common Pitfalls

### Pitfall 1: Importing Server Actions from MCP

**What goes wrong:** `import { createNote } from "@/actions/note-actions"` causes `"use server"` to be evaluated in the MCP stdio process, which either crashes or silently corrupts behavior. `revalidatePath` is not defined outside Next.js.

**Why it happens:** Developers see the server actions and assume they can be reused anywhere.

**How to avoid:** MCP tools MUST import from `@/lib/fts`, `@/lib/file-utils`, and use `../db` directly. Copy the logic, not the module.

**Warning signs:** TypeScript builds fine but MCP crashes at startup with "Cannot read properties of undefined" or "revalidatePath is not a function".

### Pitfall 2: SQLite Case Sensitivity in Prisma

**What goes wrong:** `db.project.findMany({ where: { name: { contains: "myproj" } } })` returns nothing for a project named "MyProj" because SQLite LIKE is case-sensitive by default in Prisma.

**Why it happens:** Prisma SQLite does not support `mode: "insensitive"` (it's PostgreSQL-only). The default `contains` maps to `LIKE '%...%'` which in SQLite is case-sensitive for non-ASCII characters.

**How to avoid:** Lowercase the query in JS, and use a broad initial SQL filter (or no filter) followed by JS scoring. The scoring function compares `project.name.toLowerCase()` against `query.toLowerCase()`.

**Warning signs:** identify_project returns 0 results for queries that differ only in case.

### Pitfall 3: EXDEV Error on File Move Across Filesystems

**What goes wrong:** `fs.renameSync(src, dest)` throws `Error: EXDEV: cross-device link not found` when the source file is on a different filesystem (e.g., a Docker volume or mounted drive).

**Why it happens:** `rename()` syscall cannot cross filesystem boundaries.

**How to avoid:** Wrap `renameSync` in a try-catch; if `code === "EXDEV"`, fall back to `copyFileSync` + `unlinkSync`.

**Warning signs:** manage_assets `action=add` works from some paths but throws from others.

### Pitfall 4: Tool Count Creep

**What goes wrong:** Each note action (create, update, delete, get, list, search) registered as a separate tool pushes count from 18 to 24+ before assets are added.

**Why it happens:** It feels more "RESTful" to have individual tools.

**How to avoid:** The action-dispatch pattern is a locked decision. `manage_notes` covers all 6 note operations. `manage_assets` covers add/delete/list. Count after Phase 5: 18 + 3 = 21.

### Pitfall 5: Missing FTS sync in MCP note mutations

**What goes wrong:** `manage_notes` `action=create` stores the note in Prisma but forgets to call `syncNoteToFts`. Notes become invisible to `action=search`.

**Why it happens:** The sync is easy to forget when writing the MCP handler since server actions handled it transparently.

**How to avoid:** Follow the same pattern as `note-actions.ts`: every create/update must call `syncNoteToFts(db, { id, title, content })`. Every delete must call `deleteNoteFromFts(db, noteId)` BEFORE the Prisma delete.

---

## Code Examples

### Tool Registration Pattern (from server.ts)

```typescript
// src/mcp/server.ts — add to imports and allTools spread
import { knowledgeTools } from "./tools/knowledge-tools";
import { noteAssetTools } from "./tools/note-asset-tools";

const allTools = {
  ...workspaceTools,
  ...projectTools,
  ...taskTools,
  ...labelTools,
  ...searchTools,
  ...knowledgeTools,   // adds: identify_project
  ...noteAssetTools,   // adds: manage_notes, manage_assets
};
```

### Scoring Function

```typescript
// Inline in knowledge-tools.ts — no external library
function scoreProject(
  project: { name: string; alias?: string | null; description?: string | null },
  q: string
): number {
  const name = project.name.toLowerCase();
  const alias = project.alias?.toLowerCase() ?? "";
  const desc = project.description?.toLowerCase() ?? "";

  const nameScore = name === q ? 1.0
    : name.startsWith(q) ? 0.9
    : name.includes(q) ? 0.75
    : 0.0;

  const aliasScore = alias && (alias === q ? 0.85
    : alias.startsWith(q) ? 0.75
    : alias.includes(q) ? 0.6
    : 0.0) || 0.0;

  const descScore = desc.includes(q) ? 0.4 : 0.0;

  return Math.max(nameScore, aliasScore, descScore);
}
```

### manage_notes Handler Skeleton

```typescript
// src/mcp/tools/note-asset-tools.ts
import { z } from "zod";
import { db } from "../db";
import { searchNotes, syncNoteToFts, deleteNoteFromFts } from "@/lib/fts";

const manageNotesSchema = z.object({
  action: z.enum(["create", "update", "delete", "get", "list", "search"]),
  projectId: z.string().optional(),
  noteId: z.string().optional(),
  title: z.string().optional(),
  content: z.string().optional(),
  category: z.string().optional(),
  query: z.string().optional(),
});

async function manageNotesHandler(args: z.infer<typeof manageNotesSchema>) {
  switch (args.action) {
    case "create": {
      if (!args.projectId || !args.title) throw new Error("projectId and title required");
      const note = await db.projectNote.create({
        data: {
          title: args.title,
          content: args.content ?? "",
          category: args.category ?? "备忘",
          projectId: args.projectId,
        },
      });
      await syncNoteToFts(db, { id: note.id, title: note.title, content: note.content });
      return note;
    }
    case "update": {
      if (!args.noteId) throw new Error("noteId required");
      const note = await db.projectNote.update({
        where: { id: args.noteId },
        data: {
          ...(args.title !== undefined && { title: args.title }),
          ...(args.content !== undefined && { content: args.content }),
          ...(args.category !== undefined && { category: args.category }),
        },
      });
      await syncNoteToFts(db, { id: note.id, title: note.title, content: note.content });
      return note;
    }
    case "delete": {
      if (!args.noteId) throw new Error("noteId required");
      await deleteNoteFromFts(db, args.noteId);
      await db.projectNote.delete({ where: { id: args.noteId } });
      return { deleted: true, noteId: args.noteId };
    }
    case "get": {
      if (!args.noteId) throw new Error("noteId required");
      return db.projectNote.findUnique({ where: { id: args.noteId } });
    }
    case "list": {
      if (!args.projectId) throw new Error("projectId required");
      return db.projectNote.findMany({
        where: { projectId: args.projectId, ...(args.category ? { category: args.category } : {}) },
        orderBy: { updatedAt: "desc" },
      });
    }
    case "search": {
      if (!args.projectId || !args.query) throw new Error("projectId and query required");
      return searchNotes(db, args.projectId, args.query);
    }
  }
}
```

### manage_assets Handler Skeleton

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureAssetsDir, listAssetFiles } from "@/lib/file-utils";

const manageAssetsSchema = z.object({
  action: z.enum(["add", "delete", "list", "get"]),
  projectId: z.string().optional(),
  assetId: z.string().optional(),
  sourcePath: z.string().optional(),  // absolute path to source file (for "add")
  filename: z.string().optional(),    // override destination filename (for "add")
});

async function manageAssetsHandler(args: z.infer<typeof manageAssetsSchema>) {
  switch (args.action) {
    case "add": {
      if (!args.projectId || !args.sourcePath) throw new Error("projectId and sourcePath required");
      const assetsDir = ensureAssetsDir(args.projectId);
      const filename = args.filename ?? path.basename(args.sourcePath);
      const destPath = path.join(assetsDir, filename);
      // mv with EXDEV fallback
      try {
        fs.renameSync(args.sourcePath, destPath);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EXDEV") {
          fs.copyFileSync(args.sourcePath, destPath);
          fs.unlinkSync(args.sourcePath);
        } else throw e;
      }
      const stats = fs.statSync(destPath);
      return db.projectAsset.create({
        data: { filename, path: destPath, size: stats.size, projectId: args.projectId },
      });
    }
    case "delete": {
      if (!args.assetId) throw new Error("assetId required");
      await db.projectAsset.delete({ where: { id: args.assetId } });
      return { deleted: true, assetId: args.assetId };
    }
    case "list": {
      if (!args.projectId) throw new Error("projectId required");
      return db.projectAsset.findMany({
        where: { projectId: args.projectId },
        orderBy: { createdAt: "desc" },
      });
    }
    case "get": {
      if (!args.assetId) throw new Error("assetId required");
      return db.projectAsset.findUnique({ where: { id: args.assetId } });
    }
  }
}
```

---

## Tool Count Audit

| File | Tools | Count |
|------|-------|-------|
| workspace-tools.ts | list_workspaces, create_workspace, update_workspace, delete_workspace | 4 |
| project-tools.ts | list_projects, create_project, update_project, delete_project | 4 |
| task-tools.ts | list_tasks, create_task, update_task, move_task, delete_task | 5 |
| label-tools.ts | list_labels, create_label, delete_label, set_task_labels | 4 |
| search-tools.ts | search | 1 |
| **Current total** | | **18** |
| knowledge-tools.ts (NEW) | identify_project | 1 |
| note-asset-tools.ts (NEW) | manage_notes, manage_assets | 2 |
| **Phase 5 total** | | **21** |
| **Ceiling** | | **30** |
| **Remaining budget** | | **9** |

Constraint satisfied with 9 slots remaining for future phases.

---

## Validation Architecture

`workflow.nyquist_validation` is not set in `.planning/config.json` — treat as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run --reporter=verbose tests/unit/mcp/` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROJ-01 | `identify_project` returns correct project for partial name | unit | `pnpm test:run tests/unit/mcp/knowledge-tools.test.ts` | ❌ Wave 0 |
| PROJ-02 | name-match confidence > alias-match > description-match | unit | same file | ❌ Wave 0 |
| PROJ-03 | `identify_project` returns confidence field (0-1) | unit | same file | ❌ Wave 0 |
| NOTE-04 | `manage_notes action=create` stores note + FTS synced | unit | `pnpm test:run tests/unit/mcp/note-asset-tools.test.ts` | ❌ Wave 0 |
| NOTE-04 | `manage_notes action=search` returns FTS results | unit | same file | ❌ Wave 0 |
| ASST-03 | `manage_assets action=add` moves file into `data/assets/{projectId}/` | unit | same file | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run tests/unit/mcp/`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/mcp/knowledge-tools.test.ts` — covers PROJ-01, PROJ-02, PROJ-03
- [ ] `tests/unit/mcp/note-asset-tools.test.ts` — covers NOTE-04, ASST-03

Note: Existing test pattern (integration against real SQLite with `// @vitest-environment node`) should be followed. Use the same `beforeAll`/`afterAll`/`afterEach` cleanup pattern from `fts.test.ts`.

---

## Environment Availability

Step 2.6: All dependencies are Node.js built-ins and already-installed npm packages. No external services or CLI tools beyond what's already in the project.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node:fs` | manage_assets file move | ✓ | built-in | — |
| `node:path` | asset path construction | ✓ | built-in | — |
| `@prisma/client` | all tools | ✓ | project version | — |
| `@modelcontextprotocol/sdk` | MCP server | ✓ | ^1.28.0 | — |
| `zod` | input validation | ✓ | ^4.3.6 | — |
| SQLite FTS5 (`notes_fts`) | manage_notes search | ✓ | created in Phase 4 | — |

**Missing dependencies with no fallback:** None.

---

## Open Questions

1. **All-workspace vs. workspace-scoped `identify_project`**
   - What we know: Projects have a `workspaceId` FK. Agents may not always know which workspace to search.
   - What's unclear: Should `identify_project` search all workspaces by default when no `workspaceId` is provided?
   - Recommendation: Yes — make `workspaceId` optional and search all workspaces when omitted. Return `workspaceName` in results so the caller can disambiguate.

2. **Fuzzy threshold validation (flagged in STATE.md)**
   - What we know: A 0.85 alias threshold was chosen but not validated.
   - What's unclear: Real short project names (3-4 chars) may produce unexpected scores.
   - Recommendation: Write the scoring function with named constants (`NAME_EXACT = 1.0`, `ALIAS_EXACT = 0.85`, etc.) so values can be tuned without refactoring. Add a test with a 3-char alias like "app" to validate.

3. **File deletion with manage_assets `action=delete`**
   - What we know: `deleteAsset` in the server action only deletes the DB record, not the file on disk.
   - What's unclear: Should the MCP tool also `unlink` the file, or just the DB record?
   - Recommendation: Match the server action behavior (DB record only) for Phase 5. Physical file cleanup is a Phase 6/7 concern when the UI file management is in place.

---

## Sources

### Primary (HIGH confidence)

- Codebase direct inspection — all `src/mcp/`, `src/lib/`, `src/actions/` files read
- `prisma/schema.prisma` — confirmed ProjectNote and ProjectAsset models exist
- `src/mcp/server.ts` — confirmed tool registration pattern
- `package.json` — confirmed `@modelcontextprotocol/sdk ^1.28.0`, `zod ^4.3.6`
- `tests/unit/lib/fts.test.ts` — confirmed test pattern for integration tests
- `.planning/STATE.md` — confirmed all locked decisions
- `.planning/config.json` — confirmed `nyquist_validation` not set (treat as enabled)

### Secondary (MEDIUM confidence)

- Node.js docs: `fs.renameSync` EXDEV behavior on cross-device moves — standard Node.js behavior, verified against known docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed and in use
- Architecture: HIGH — patterns directly derived from existing codebase
- Pitfalls: HIGH — derived from locked decisions and code inspection
- Scoring algorithm: MEDIUM — thresholds are reasonable but flagged for validation

**Research date:** 2026-03-27
**Valid until:** 2026-05-27 (stable stack, 60 days)
