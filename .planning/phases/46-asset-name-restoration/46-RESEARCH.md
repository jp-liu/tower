# Phase 46: Asset Name Restoration - Research

**Researched:** 2026-04-20
**Domain:** File utility / MCP task creation / UUID stripping
**Confidence:** HIGH

## Summary

Phase 46 adds UUID-stripping logic when reference files from the assistant cache are copied into project assets during `create_task`. The cache naming convention (`{stem}-{8hex}.{ext}` or `tower_image-{8hex}.{ext}`) is established by `buildCacheFilename` in `file-utils.ts`. The inverse operation — stripping the `-{8hex}` suffix to recover a human-readable name — is a small, well-scoped pure function that must also handle name collisions.

The entire change is isolated to `src/mcp/tools/task-tools.ts`, where the reference-copy loop already lives (lines 102–144). A new helper `stripCacheUuidSuffix(filename)` in `src/lib/file-utils.ts` performs the stripping, keeping the logic testable in isolation. The existing collision-avoidance approach (append `Date.now()`) needs to be preserved for non-cache files but replaced with a counter-suffix approach that keeps names readable for cache files.

**Primary recommendation:** Add `stripCacheUuidSuffix()` to `file-utils.ts` and call it inside the reference-copy loop in `task-tools.ts`, gated by a cache-path detection predicate.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — all implementation choices are at Claude's discretion.

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions.

### Deferred Ideas (OUT OF SCOPE)
None — infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ASSET-01 | `create_task` references from cache copied to asset with UUID suffix stripped to restore readable filename | Existing copy loop in `task-tools.ts` lines 102–144; `buildCacheFilename` pattern in `file-utils.ts` reveals the exact UUID format to strip |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:path | built-in | `basename`, `extname`, `join` | Already used throughout `file-utils.ts` and `task-tools.ts` |
| node:fs | built-in | `existsSync`, `copyFileSync`, `mkdirSync` | Already used in the copy loop |
| node:crypto | built-in | Not needed for this phase | UUID generation only (not needed for stripping) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.1.1 | Unit testing | All new pure functions must have vitest tests; see `src/lib/__tests__/file-utils.test.ts` |

**Installation:** No new packages required. All needed APIs are already imported.

## Architecture Patterns

### Where the change lives

The reference copy loop is in `src/mcp/tools/task-tools.ts`, handler for `create_task` (lines 102–144). The current logic:

```
for (const filePath of args.references) {
  let filename = basename(filePath);          // today: copies name as-is
  // collision check with Date.now() suffix
  copyFileSync(filePath, dest);
  db.projectAsset.create(...)
}
```

The change inserts a name-transformation step between `basename(filePath)` and the collision check.

### Recommended Project Structure
No new directories needed. Changes touch:
```
src/
├── lib/
│   ├── file-utils.ts           # Add: stripCacheUuidSuffix(), isCachePath()
│   └── __tests__/
│       └── file-utils.test.ts  # Add: ASSET-01 tests
└── mcp/
    └── tools/
        └── task-tools.ts       # Modify: call stripCacheUuidSuffix() in copy loop
```

### Pattern 1: UUID Stripping Helper
**What:** Pure function that detects and strips the `-{8hex}` suffix from cache filenames.
**When to use:** Only for files whose path is inside the assistant cache root.

```typescript
// src/lib/file-utils.ts

/**
 * Strip the 8-hex UUID suffix added by buildCacheFilename.
 * e.g. "设计稿-a1b2c3d4.png" → "设计稿.png"
 *      "tower_image-a1b2c3d4.png" → "tower_image.png"
 *      "already-clean.png" → "already-clean.png" (no change)
 */
const CACHE_UUID_SUFFIX_RE = /-([0-9a-f]{8})(\.[^.]+)$/i;

export function stripCacheUuidSuffix(filename: string): string {
  return filename.replace(CACHE_UUID_SUFFIX_RE, "$2");
}

/**
 * Returns true if the absolute filePath is inside the assistant cache root.
 * Used to gate UUID stripping — only strip for cache files.
 */
export function isAssistantCachePath(filePath: string): boolean {
  const root = getAssistantCacheRoot();
  return filePath.startsWith(root + path.sep);
}
```

**Design note:** `getAssistantCacheRoot()` is already exported from `file-utils.ts`. `CACHE_UUID_SUFFIX_RE` matches exactly 8 hex chars immediately before the extension — this is the format enforced by `buildCacheFilename`.

### Pattern 2: Collision Avoidance for Stripped Names
**What:** When stripping produces a name that already exists in the assets dir, append a monotonically increasing counter `(1)`, `(2)`, etc. rather than a timestamp. This keeps the filename readable.

```typescript
// Inside task-tools.ts copy loop, after stripping:
function resolveNonCollidingName(assetsDir: string, desiredName: string): string {
  if (!existsSync(join(assetsDir, desiredName))) return desiredName;
  const ext = extname(desiredName);
  const base = basename(desiredName, ext);
  let counter = 1;
  let candidate: string;
  do {
    candidate = `${base} (${counter})${ext}`;
    counter++;
  } while (existsSync(join(assetsDir, candidate)));
  return candidate;
}
```

**Alternatively** (simpler, inline): The existing `Date.now()` approach is acceptable for non-cache paths. For cache paths, use counter approach for readable names. Both are valid — choose one and apply consistently.

**Decision left to planner:** Counter suffix `(1)` vs timestamp. Either satisfies success criterion 3. Counter is more human-friendly.

### Pattern 3: Gate on Cache Path Detection
**What:** Apply stripping only when the source file is inside the assistant cache directory.
**When to use:** Always — ensures references already in assets (or from arbitrary paths) are copied unchanged (success criterion 4).

```typescript
// In task-tools.ts copy loop:
const isCache = isAssistantCachePath(filePath);
let filename = isCache
  ? stripCacheUuidSuffix(basename(filePath))
  : basename(filePath);
// then collision check...
```

### Anti-Patterns to Avoid
- **Stripping all filenames:** Only strip when the file originates from the assistant cache. Other reference files must be copied unchanged.
- **Greedy UUID regex:** Pattern `-[0-9a-f]+` would match too broadly (e.g., hex-containing stems). Use exactly `-[0-9a-f]{8}` to match the fixed 8-char UUID used by `buildCacheFilename`.
- **Case-sensitive hex match:** Use `/i` flag or lowercase match — `crypto.randomUUID` produces lowercase hex but defensive matching is safer.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| UUID detection regex | Complex parser | Simple `-[0-9a-f]{8}` anchored before extension |
| Directory creation | Manual checks | `mkdirSync(dir, { recursive: true })` (already used) |
| Path containment check | Custom logic | `path.startsWith(root + path.sep)` (pattern from `assertWithinDataRoot`) |

**Key insight:** The UUID format is fixed and controlled entirely by `buildCacheFilename`. A simple regex is the correct tool — no external library needed.

## Common Pitfalls

### Pitfall 1: Stripping UUID from Non-Cache Filenames
**What goes wrong:** A file called `report-a1b2c3d4.pdf` (not from the cache) gets its suffix stripped unintentionally.
**Why it happens:** Regex applied to all reference filenames without cache-path gating.
**How to avoid:** Check `isAssistantCachePath(filePath)` before stripping.
**Warning signs:** Reference files from arbitrary locations arrive with names truncated.

### Pitfall 2: Regex Too Greedy or Too Narrow
**What goes wrong:** Files with names like `v1-2-final.png` get stripped to `v1-2-final.png` (fine) vs `my-logo2024.png` losing its "2024" (only 4 chars — not 8, so fine).
**Why it happens:** Wrong character count in regex.
**How to avoid:** `{8}` exactly, anchored to `-` before the extension. `buildCacheFilename` always generates exactly 8 hex chars via `slice(0, 8)`.
**Warning signs:** Unit tests with `tower_image-a1b2c3d4.png` → `tower_image.png` pass but `tower_image-a1b2c3d4e5f6.png` (12 hex) is not stripped (correct).

### Pitfall 3: Collision When Two Cache Files Produce the Same Stripped Name
**What goes wrong:** Both `设计稿-a1b2c3d4.png` and `设计稿-b2c3d4e5.png` strip to `设计稿.png`; second copy overwrites the first.
**Why it happens:** No collision check after stripping.
**How to avoid:** Run collision check on the stripped name, not the original. The existing `existsSync` check in the loop must operate on the stripped name.
**Warning signs:** Success criterion 3 test case fails.

### Pitfall 4: Import of `getAssistantCacheRoot` in task-tools.ts
**What goes wrong:** `task-tools.ts` does not currently import from `file-utils.ts` — adding the import brings in `mkdirSync` side effects if `getAssistantCacheDir` is called at import time.
**Why it happens:** `getAssistantCacheDir` creates dirs on call; `getAssistantCacheRoot` does not.
**How to avoid:** Import only `isAssistantCachePath` and `stripCacheUuidSuffix` from `file-utils.ts`. Both are pure (no side effects).

## Code Examples

### Verified patterns from existing codebase

#### Existing UUID generation (buildCacheFilename in file-utils.ts)
```typescript
// Source: src/lib/file-utils.ts line 67
const uuid8 = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
// produces exactly 8 lowercase hex chars, appended as `-{uuid8}`
```

#### Existing collision avoidance pattern (task-tools.ts lines 114–119)
```typescript
// Source: src/mcp/tools/task-tools.ts lines 113-119
const destCheck = join(assetsDir, filename);
if (existsSync(destCheck)) {
  const ext = extname(filename);
  const base = basename(filename, ext);
  filename = `${base}-${Date.now()}${ext}`;
}
```

#### Existing path containment guard (file-utils.ts lines 7–11)
```typescript
// Source: src/lib/file-utils.ts lines 7-11
function assertWithinDataRoot(resolved: string): void {
  if (!resolved.startsWith(DATA_ROOT + path.sep)) {
    throw new Error("Path traversal detected");
  }
}
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Flat cache `data/cache/assistant/<uuid>.<ext>` | Phase 44: `data/cache/assistant/YYYY-MM/images/{stem}-{8hex}.{ext}` | UUID now embedded in stem, not standalone — stripping is `-{8hex}` before extension |
| Copy references as-is to assets | Phase 46 (this phase): strip UUID before copy | Human-readable asset filenames |

## Open Questions

1. **Counter vs timestamp for collision suffix**
   - What we know: Both satisfy success criterion 3 (no overwrite).
   - What's unclear: User preference — `设计稿 (1).png` vs `设计稿-1714000000.png`.
   - Recommendation: Use counter `(1)` pattern — more conventional for "Save As" duplicate naming.

## Environment Availability

Step 2.6: SKIPPED — no external dependencies. Pure TypeScript utility functions using Node.js built-ins already present in the codebase.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.1 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run -- --reporter=verbose src/lib/__tests__/file-utils.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ASSET-01 | `stripCacheUuidSuffix("设计稿-a1b2c3d4.png")` returns `"设计稿.png"` | unit | `pnpm test:run -- src/lib/__tests__/file-utils.test.ts` | ❌ Wave 0 |
| ASSET-01 | `stripCacheUuidSuffix("tower_image-a1b2c3d4.png")` returns `"tower_image.png"` | unit | same | ❌ Wave 0 |
| ASSET-01 | `isAssistantCachePath` returns true for cache path, false for assets path | unit | same | ❌ Wave 0 |
| ASSET-01 | Two cache files with same stem produce non-colliding asset names | unit | same | ❌ Wave 0 |
| ASSET-01 | Non-cache reference copied unchanged (no UUID stripping) | unit | same | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:run -- src/lib/__tests__/file-utils.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New `describe("stripCacheUuidSuffix")` block in `src/lib/__tests__/file-utils.test.ts` — covers ASSET-01
- [ ] New `describe("isAssistantCachePath")` block in same file — covers gating logic

*(Existing file infrastructure covers all other needs — no new files required)*

## Sources

### Primary (HIGH confidence)
- `src/lib/file-utils.ts` — `buildCacheFilename` reveals exact UUID format (`-[0-9a-f]{8}` before ext); `getAssistantCacheRoot()` is the gate function
- `src/mcp/tools/task-tools.ts` lines 102–144 — exact location of reference copy loop; collision avoidance pattern documented
- `src/lib/__tests__/file-utils.test.ts` — existing test patterns to follow for new ASSET-01 tests

### Secondary (MEDIUM confidence)
- `src/actions/asset-actions.ts` — confirms asset copy pattern uses same `existsSync` + timestamp collision avoidance (consistent with task-tools)

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, all built-ins already in use
- Architecture: HIGH — change location is unambiguous (one loop in task-tools.ts + one helper in file-utils.ts)
- Pitfalls: HIGH — derived directly from code inspection of `buildCacheFilename` format and existing copy loop

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable codebase, no external dependencies)
