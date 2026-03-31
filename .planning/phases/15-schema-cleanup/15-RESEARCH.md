# Phase 15: Schema & Cleanup - Research

**Researched:** 2026-03-31
**Domain:** Prisma schema migration, Next.js server actions, git branch listing, dead code removal
**Confidence:** HIGH

## Summary

Phase 15 is a focused schema-and-cleanup phase with three distinct workstreams: (1) adding two new nullable fields to the Prisma schema (`baseBranch` on `Task`, `worktreePath`/`worktreeBranch` on `TaskExecution`), (2) exposing local git branch listing as a server action, and (3) surgically removing the dead `branchTemplate` config — which spans 4 source files, one lib file, one test file, and two i18n locale blocks.

The existing `/api/git` route already returns `branches` from `git branch --format='%(refname:short)'`. The branch listing requirement (implied by BR-02's companion phase 16 need) can be satisfied by a new server action wrapping that same `execSync` logic, keeping it server-action-compatible and consistent with the project's action-based data-access pattern.

Schema changes follow the established project pattern: add nullable fields to `schema.prisma`, run `pnpm db:push` (no migrations directory — project uses `prisma db push`), then regenerate the client with `pnpm db:generate`. Server action signatures for `createTask` and `startTaskExecution` must be extended to accept the new optional fields.

**Primary recommendation:** Three independent tasks in one wave — schema migration first (Task and TaskExecution), then `getProjectBranches` server action, then branchTemplate deletion sweep. No dependencies between the last two; schema must come first so generated client types are available.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BR-02 | Task data model adds `baseBranch` nullable string field | Prisma schema + `db:push` pattern; `createTask`/`updateTask` server actions need extension |
| WT-03 | TaskExecution adds `worktreePath` and `worktreeBranch` nullable string fields | Same Prisma pattern; `startTaskExecution` server action signature needs extension |
| CL-01 | Remove `git.branchTemplate` from settings UI, SystemConfig defaults, and all call sites | 4 source files + 1 lib file + 1 test file identified; complete deletion map below |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| prisma | ^6.19.2 | Schema definition, DB push, client generation | Already in use |
| @prisma/client | ^6.19.2 | Type-safe DB access in actions | Already in use |
| child_process (Node built-in) | N/A | `execSync` for `git branch` command | Already used in `/api/git/route.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | existing | Unit tests for new server action | Already configured; run with `pnpm test:run` |

**No new packages required.** All capabilities already exist in the project.

## Architecture Patterns

### Prisma Schema Update Pattern (established in this project)

1. Edit `prisma/schema.prisma` — add nullable field with `String?`
2. Run `pnpm db:push` — applies schema to SQLite without generating a migration file
3. Run `pnpm db:generate` — regenerates Prisma client types
4. Existing rows get `NULL` for the new column automatically (SQLite behavior for nullable column additions via `ALTER TABLE ADD COLUMN`)

```prisma
// Add to Task model (BR-02)
baseBranch String?

// Add to TaskExecution model (WT-03)
worktreePath   String?
worktreeBranch String?
```

### Server Action Extension Pattern (established in task-actions.ts)

Extend existing action signatures to accept new optional fields. Follow existing `data: { field?: type }` pattern.

```typescript
// createTask — add baseBranch
export async function createTask(data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: Priority;
  status?: TaskStatus;
  labelIds?: string[];
  baseBranch?: string;   // NEW — BR-02
}) {
  const task = await db.task.create({
    data: {
      ...
      baseBranch: data.baseBranch ?? null,
    },
  });
  ...
}

// updateTask — add baseBranch
export async function updateTask(
  taskId: string,
  data: { title?: string; description?: string; priority?: Priority; labelIds?: string[]; baseBranch?: string }
) { ... }
```

```typescript
// startTaskExecution — add worktreePath, worktreeBranch
export async function startTaskExecution(
  taskId: string,
  agent?: string,
  worktreePath?: string,   // NEW — WT-03
  worktreeBranch?: string  // NEW — WT-03
) { ... }
```

### New Server Action: getProjectBranches

The `/api/git` route already implements `git branch --format='%(refname:short)'`. The success criterion for Phase 15 requires a "server action or API route" — since Phase 16 will call this from server-side worktree creation code, a server action in `workspace-actions.ts` (or a new `git-actions.ts`) is the right fit.

```typescript
"use server";

import { execSync } from "child_process";
import path from "path";
import os from "os";

export async function getProjectBranches(localPath: string): Promise<string[]> {
  if (!localPath) return [];
  const resolved = path.resolve(expandHome(localPath));
  try {
    const raw = execSync(
      "git branch --format='%(refname:short)'",
      { cwd: resolved, encoding: "utf-8", timeout: 5000 }
    ).trim();
    return raw.split("\n").filter(Boolean).map((b) => b.replace(/'/g, ""));
  } catch {
    return [];
  }
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") return path.join(os.homedir(), p.slice(1));
  return p;
}
```

**File placement:** `src/actions/git-actions.ts` (new file) — keeps git-specific server actions separate from workspace/task actions. Consistent with project's per-domain action file pattern.

**Alternative:** Add to `workspace-actions.ts`. Given Phase 16 will add more git-operation actions, a dedicated `git-actions.ts` is cleaner.

### Recommended Project Structure (no changes needed)

```
src/
├── actions/
│   ├── task-actions.ts        # extend createTask, updateTask, startTaskExecution
│   └── git-actions.ts         # NEW — getProjectBranches
├── lib/
│   ├── branch-template.ts     # DELETE entirely (CL-01)
│   └── config-defaults.ts     # remove git.branchTemplate entry
├── components/
│   ├── settings/system-config.tsx   # remove branchTemplate UI, state, validation
│   └── task/task-detail-panel.tsx   # remove branchTemplate state + interpolateBranchTemplate call
└── lib/i18n.tsx               # remove 3 zh + 3 en branchTemplate translation keys
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Column addition migration | Custom SQL ALTER TABLE | `prisma db push` | Project already uses db:push; no migrations directory |
| Git branch listing | Custom git parser | `execSync("git branch --format='%(refname:short)'")` | Already implemented and tested in `/api/git/route.ts` |
| Type regeneration | Manual type file | `pnpm db:generate` | Prisma client auto-generates types from schema |

**Key insight:** The project uses `prisma db push` (not `prisma migrate`) — there is no `prisma/migrations/` directory. Do not introduce migration files; just push schema directly.

## CL-01 Deletion Map (Complete)

Every reference to `branchTemplate` that must be removed:

### 1. `src/lib/branch-template.ts` — DELETE FILE
The entire file (10 lines). Contains `interpolateBranchTemplate` and `validateBranchTemplate`. Once CL-01 is complete and Phase 16 uses fixed `task/{taskId}` branch format, neither function is needed.

### 2. `src/lib/config-defaults.ts` — Remove entry
```typescript
// DELETE these 5 lines:
"git.branchTemplate": {
  defaultValue: "vk/{taskIdShort}-",
  type: "string",
  label: "Branch Naming Template",
},
```

### 3. `src/components/settings/system-config.tsx` — Remove branchTemplate from GitParamsForm section
- Line 7: remove `import { validateBranchTemplate } from "@/lib/branch-template";`
- Line 35: change `type GitParamsForm = { timeoutSec: number; branchTemplate: string };` to `type GitParamsForm = { timeoutSec: number };`
- Line 47: remove `branchTemplate: "vk/{taskIdShort}-"` from initial state
- Line 49: remove `const [branchTemplateError, setBranchTemplateError] = useState("");`
- Lines 57-58: remove `"git.branchTemplate"` from `getConfigValues` keys array
- Lines 70-71: remove `branchTemplate: (cfg["git.branchTemplate"] as string) ?? "..."` from state mapping
- Lines 87-93: remove branchTemplate validation block from `handleSaveGitParams` + remove `git.branchTemplate` setConfigValue call
- Lines 473-489: remove the entire branchTemplate `<div>` UI block
- Update `handleSaveGitParams` to only save `git.timeoutSec`
- Update section description string key `gitParams.desc` (currently "Git 操作超时与分支命名模板") — but keep i18n key, just update value

### 4. `src/components/task/task-detail-panel.tsx` — Remove branchTemplate usage
- Line 10: remove `import { interpolateBranchTemplate } from "@/lib/branch-template";`
- Line 9: remove `import { getConfigValue } from "@/actions/config-actions";` if no other use; if still used, keep
- Line 29: remove `const [branchTemplate, setBranchTemplate] = useState("vk/{taskIdShort}-");`
- Lines 69-72: remove the `useEffect` that loads `git.branchTemplate` config
- Line 206: the `branch` prop on `<TaskMetadata>` — replace `interpolateBranchTemplate(branchTemplate, task.id)` with `task/task.id` (the fixed Phase 16 format) or remove the prop entirely (Phase 16 will handle branch display)

**Decision needed (low stakes):** Does `TaskMetadata` still show a branch at all in Phase 15 before Phase 16 implements worktrees? Options:
- Pass `"task/${task.id}"` as the fixed format (matches v0.5 branch name convention from STATE.md)
- Remove `branch` prop entirely (TaskMetadata may handle null gracefully)

Recommendation: pass `\`task/${task.id}\`` as the fixed value — it's the correct v0.5 convention per STATE.md decision "[v0.5]: Branch name is task/{taskId}".

### 5. `src/lib/i18n.tsx` — Remove 6 branchTemplate translation keys

**ZH locale (3 keys, lines 211-213):**
```
"settings.config.gitParams.branchTemplate"
"settings.config.gitParams.branchTemplateHint"
"settings.config.gitParams.branchTemplateInvalid"
```

**EN locale (3 keys, lines 522-524):**
```
"settings.config.gitParams.branchTemplate"
"settings.config.gitParams.branchTemplateHint"
"settings.config.gitParams.branchTemplateInvalid"
```

Also update the section description keys:
- ZH line 208: `"settings.config.gitParams.desc": "Git 操作超时与分支命名模板"` → `"Git 操作超时"`
- EN line 519: `"settings.config.gitParams.desc": "Git operation timeout and branch naming template"` → `"Git operation timeout"`

### 6. `tests/unit/lib/branch-template.test.ts` — DELETE FILE
57-line test file entirely covering `interpolateBranchTemplate` and `validateBranchTemplate`. Once `branch-template.ts` is deleted, this test file must be deleted too.

## Common Pitfalls

### Pitfall 1: SQLite Nullable Column in db:push
**What goes wrong:** Prisma `db:push` on SQLite adds new nullable columns with `DEFAULT NULL`. Existing rows receive NULL automatically. This is safe and expected.
**Why it happens:** SQLite allows `ALTER TABLE ADD COLUMN ... DEFAULT NULL` without full table rebuild.
**How to avoid:** Confirm fields are defined as `String?` (nullable) in schema — never add a required field without a default via `db:push` on a populated database.
**Warning signs:** If a field is `String` (not nullable) without a `@default`, `db:push` will fail on SQLite when rows exist.

### Pitfall 2: Forgetting pnpm db:generate After Schema Change
**What goes wrong:** TypeScript types still reflect the old schema; new fields appear as `unknown` in IDE or cause type errors.
**Why it happens:** The Prisma client is generated code — it doesn't auto-reload from schema.prisma.
**How to avoid:** Always run `pnpm db:generate` immediately after `pnpm db:push`.
**Warning signs:** TypeScript errors on `db.task.create({ data: { baseBranch: ... } })`.

### Pitfall 3: Incomplete branchTemplate Removal Leaves Import Errors
**What goes wrong:** Deleting `branch-template.ts` without removing imports from `system-config.tsx` and `task-detail-panel.tsx` causes a compile error.
**Why it happens:** TypeScript/Next.js build fails on missing module imports.
**How to avoid:** Delete the imports before or simultaneously with the lib file deletion.
**Warning signs:** `Module not found: Can't resolve '@/lib/branch-template'` during build.

### Pitfall 4: getConfigValues Call Still Requests git.branchTemplate
**What goes wrong:** The `getConfigValues` call in `system-config.tsx` still includes `"git.branchTemplate"` in its keys array. The function handles missing keys gracefully (returns null or default), but it's dead code and misleading.
**Why it happens:** Easy to miss one reference in the bulk keys array.
**How to avoid:** After removing the key from the array, verify the array length went from 8 to 7 entries.
**Warning signs:** The `branchTemplate` key still appearing in the network call or state object.

### Pitfall 5: Task Detail Panel Still Imports getConfigValue After Removal
**What goes wrong:** `task-detail-panel.tsx` imports both `getConfigValue` (for branchTemplate) and potentially nothing else from `config-actions`. If `getConfigValue` is the only import, the whole import line must be removed.
**Why it happens:** Removing the useEffect but forgetting the import.
**How to avoid:** After removing the branchTemplate useEffect, check if `getConfigValue` is used anywhere else in the file.
**Warning signs:** Unused import lint warning or dead import.

## Code Examples

### getProjectBranches server action (new)
```typescript
// src/actions/git-actions.ts
// Source: /api/git/route.ts pattern, verified in codebase
"use server";

import { execSync } from "child_process";
import path from "path";
import os from "os";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") return path.join(os.homedir(), p.slice(1));
  return p;
}

export async function getProjectBranches(localPath: string): Promise<string[]> {
  if (!localPath?.trim()) return [];
  const resolved = path.resolve(expandHome(localPath));
  try {
    const raw = execSync(
      "git branch --format='%(refname:short)'",
      { cwd: resolved, encoding: "utf-8", timeout: 5000 }
    ).trim();
    return raw.split("\n").filter(Boolean).map((b) => b.replace(/'/g, ""));
  } catch {
    return [];
  }
}
```

### Prisma schema additions
```prisma
// Source: prisma/schema.prisma — add to existing models
model Task {
  // ... existing fields ...
  baseBranch  String?    // BR-02: optional base branch for worktree creation
}

model TaskExecution {
  // ... existing fields ...
  worktreePath   String?   // WT-03: absolute path to worktree directory
  worktreeBranch String?   // WT-03: branch name used in this worktree
}
```

### Updated createTask signature
```typescript
// Source: src/actions/task-actions.ts — extend existing function
export async function createTask(data: {
  title: string;
  description?: string;
  projectId: string;
  priority?: Priority;
  status?: TaskStatus;
  labelIds?: string[];
  baseBranch?: string;  // NEW
}) {
  const task = await db.task.create({
    data: {
      title: data.title,
      description: data.description,
      projectId: data.projectId,
      priority: data.priority ?? "MEDIUM",
      status: data.status ?? "TODO",
      baseBranch: data.baseBranch ?? null,  // NEW
    },
  });
  ...
}
```

### Fixed branch display in TaskDetailPanel
```typescript
// Replace interpolateBranchTemplate(branchTemplate, task.id) with:
branch={`task/${task.id}`}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Branch name from user-configurable template (`vk/{taskIdShort}-`) | Fixed format `task/{taskId}` | v0.5 decision (STATE.md) | branchTemplate config becomes dead code |
| No worktree tracking on TaskExecution | `worktreePath`/`worktreeBranch` fields | Phase 15 (this phase) | Phase 16 can write worktree paths at execution time |

**Deprecated/outdated:**
- `git.branchTemplate` config key: superseded by v0.5 fixed branch naming — `task/{taskId}`. Can optionally purge existing DB rows (a `DELETE FROM SystemConfig WHERE key = 'git.branchTemplate'` data migration). See Open Questions.

## Open Questions

1. **Should Phase 15 purge the existing `git.branchTemplate` DB row?**
   - What we know: `db:push` doesn't remove DB data; the key/value row will remain in `SystemConfig` even after code is removed
   - What's unclear: Does a stale DB row cause any harm? Given `getConfigValues` won't request it anymore, likely no. But it's untidy.
   - Recommendation: Include a one-time cleanup step — add a data migration task that runs `db.systemConfig.deleteMany({ where: { key: 'git.branchTemplate' } })` or equivalent raw SQL. Low risk, clean.

2. **Should `handleSaveGitParams` be renamed after branchTemplate removal?**
   - What we know: The function will only save `git.timeoutSec` after cleanup
   - What's unclear: Whether the save button and section heading need copy changes too
   - Recommendation: Keep function name, update section description i18n strings (already in deletion map above). No rename needed.

3. **Does `TaskMetadata` component accept a nullable `branch` prop?**
   - What we know: `task-detail-panel.tsx` line 206 passes `branch={...}` to `TaskMetadata`
   - What's unclear: Whether TaskMetadata gracefully handles `undefined`/skips display
   - Recommendation: Pass `\`task/${task.id}\`` (always a valid string) — avoids needing to check TaskMetadata behavior.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies beyond already-available Node.js, Prisma CLI, and git — all verified present in prior phases).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | `/vitest.config.ts` |
| Quick run command | `pnpm test:run --reporter=verbose` |
| Full suite command | `pnpm test:run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BR-02 | `createTask` persists `baseBranch`; readable via server action | unit | `pnpm test:run tests/unit/actions/task-actions.test.ts` | ❌ Wave 0 |
| WT-03 | `startTaskExecution` persists `worktreePath`/`worktreeBranch` | unit | `pnpm test:run tests/unit/actions/agent-actions.test.ts` | ❌ Wave 0 |
| CL-01 | `branch-template.ts` removed; no branchTemplate import anywhere | build check | `pnpm build` | N/A — verified by build |
| CL-01 | git.branchTemplate not in CONFIG_DEFAULTS | unit | `pnpm test:run tests/unit/lib/branch-template.test.ts` DELETE | ❌ Delete existing |
| getProjectBranches | returns branches array for valid git path, empty for invalid | unit | `pnpm test:run tests/unit/actions/git-actions.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:run`
- **Per wave merge:** `pnpm test:run && pnpm build`
- **Phase gate:** Full suite green + `pnpm build` succeeds before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/actions/task-actions.test.ts` — covers BR-02 (createTask with baseBranch, updateTask with baseBranch)
- [ ] `tests/unit/actions/agent-actions.test.ts` — covers WT-03 (startTaskExecution with worktreePath/worktreeBranch)
- [ ] `tests/unit/actions/git-actions.test.ts` — covers getProjectBranches (valid path returns branches, invalid path returns empty array, non-git path returns empty array)
- [ ] DELETE `tests/unit/lib/branch-template.test.ts` — covers functions being deleted (CL-01)

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `SystemConfig` table may have a row with `key = 'git.branchTemplate'` if user saved the setting | Optional: `db.systemConfig.deleteMany({ where: { key: 'git.branchTemplate' } })` — low priority, doesn't break anything to leave it |
| Live service config | None — no external services track branchTemplate | None |
| OS-registered state | None | None |
| Secrets/env vars | None — branchTemplate is UI config, not a secret | None |
| Build artifacts | None — TypeScript compiled artifacts regenerated on build | None |

**Nothing found in categories 2-5.** The only runtime state is the optional stale DB row.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `/prisma/schema.prisma`, `src/actions/task-actions.ts`, `src/actions/config-actions.ts`, `src/lib/config-defaults.ts`, `src/lib/branch-template.ts`, `src/components/settings/system-config.tsx`, `src/components/task/task-detail-panel.tsx`, `src/app/api/git/route.ts`, `src/lib/i18n.tsx`, `tests/unit/lib/branch-template.test.ts`
- `.planning/STATE.md` — confirmed v0.5 decisions: fixed `task/{taskId}` branch format, baseBranch on Task model
- `.planning/REQUIREMENTS.md` — confirmed BR-02, WT-03, CL-01 scope
- `package.json` — confirmed Prisma 6.19.2, no migrations directory (db:push pattern)

### Secondary (MEDIUM confidence)
- Prisma SQLite behavior for nullable column addition: standard SQLite `ALTER TABLE ADD COLUMN ... DEFAULT NULL` — safe for existing rows

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools already in use, versions confirmed from package.json
- Architecture: HIGH — all patterns directly observed from existing phases (db:push, server actions, execSync git)
- Pitfalls: HIGH — derived from direct code inspection of what must change
- Deletion map: HIGH — exhaustive grep confirmed all 6 locations

**Research date:** 2026-03-31
**Valid until:** 2026-04-30 (stable codebase, no fast-moving dependencies)
