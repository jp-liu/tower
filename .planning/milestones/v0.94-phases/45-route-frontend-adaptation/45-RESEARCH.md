# Phase 45: Route & Frontend Adaptation - Research

**Researched:** 2026-04-20
**Domain:** Next.js App Router catch-all routes, file path validation, multimodal prompt building
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None — pure infrastructure/wiring phase.

### Claude's Discretion
All implementation choices are at Claude's discretion. Use ROADMAP phase goal, success criteria, and codebase conventions to guide decisions. No backward compatibility needed per STATE.md decision.

### Deferred Ideas (OUT OF SCOPE)
None — infrastructure phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROUTE-01 | Cache serve route changed to catch-all, supports subpath (`/api/internal/cache/2026-04/images/xxx.png`) | Next.js `[...segments]` catch-all route replaces `[filename]` single-segment route; path.join(cacheRoot, segments.join("/")) with containment check |
| ROUTE-02 | Frontend `<img src>` uses full subpath (year-month + type directory) | `assistant-chat-bubble.tsx` MessageImage already builds URL as `/api/internal/cache/${filename}` — since images upload now returns full sub-path (e.g., `2026-04/images/foo.png`), the URL construction requires no code change IF the stored filename IS the sub-path |
| ROUTE-03 | `buildMultimodalPrompt` uses full subpath to resolve absolute filesystem path | Function signature must change: sub-path filenames are joined to `getAssistantCacheRoot()` instead of a type-specific dir; SAFE_FILENAME_RE must be replaced with a sub-path validator; containment check against cacheRoot |
</phase_requirements>

## Summary

Phase 45 adapts three layers to work with the new year-month/type directory structure introduced in Phase 44:

1. **Route layer** (`src/app/api/internal/cache/[filename]/route.ts`): The current single-segment dynamic route `[filename]` only captures one path component. A URL like `/api/internal/cache/2026-04/images/foo.png` would 404 because Next.js only routes `/api/internal/cache/[filename]` where `[filename]` matches a single path token. This must become a catch-all route `[...segments]` to accept multiple path components.

2. **Frontend layer** (`src/components/assistant/assistant-chat-bubble.tsx`): The `MessageImage` component constructs its URL as `` `/api/internal/cache/${filename}` ``. Since the images upload route (`/api/internal/assistant/images/route.ts`) already returns the sub-path (e.g., `"2026-04/images/设计稿-a1b2c3d4.png"`) as `filename` in its JSON response, and `assistant-provider.tsx` passes `imageFilenames` through unchanged, the URL construction in the bubble component requires **no code change** — it already produces the correct full sub-path URL. However, the validation regex in `chat/route.ts` still uses the old UUID-only pattern and will reject sub-path filenames.

3. **Prompt builder layer** (`src/lib/build-multimodal-prompt.ts`): The function validates filenames against `SAFE_FILENAME_RE` (UUID v4 format only) and joins them to `cacheDir`. After Phase 44, filenames are sub-paths (`2026-04/images/foo.png`), not flat filenames. The `SAFE_FILENAME_RE` filter will reject all new sub-path filenames, and the `path.join(cacheDir, filename)` call must now join against `getAssistantCacheRoot()` instead.

**Primary recommendation:** Three targeted changes — (1) rename route directory to `[...segments]` and rewrite route handler, (2) update `IMAGE_FILENAME_RE` in chat route and `SAFE_FILENAME_RE` in build-multimodal-prompt to accept sub-paths, (3) delete flat-path cache files from `data/cache/assistant/` root. No backward compatibility code needed.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 15+ (project uses) | Catch-all dynamic route `[...segments]` | Built-in — no extra deps |
| node:path | built-in | Path joining and containment check | Already used throughout codebase |
| node:fs | built-in | File deletion for migration cleanup | Already used throughout codebase |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | (project uses) | Unit tests for new validation and path logic | All new logic requires unit test coverage |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Next.js catch-all `[...segments]` | Middleware rewrite | Catch-all is simpler, idiomatic, and doesn't require a middleware file |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Project Structure

The only file system change is renaming the route directory:

```
src/app/api/internal/cache/
├── [...segments]/       # was: [filename]/
│   └── route.ts         # rewritten catch-all handler
```

All other changes are in-place edits to existing files.

### Pattern 1: Next.js Catch-All Route

**What:** Replace `[filename]` (single segment) with `[...segments]` (array of path components) so subpaths like `2026-04/images/foo.png` resolve correctly.

**When to use:** When the dynamic portion of a URL can contain slashes (nested directories).

**Example:**
```typescript
// src/app/api/internal/cache/[...segments]/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ segments: string[] }> }
) {
  const { segments } = await params;
  // segments = ["2026-04", "images", "设计稿-a1b2c3d4.png"]
  const subPath = segments.join("/");
  // Resolve against the assistant cache root
  const cacheRoot = getAssistantCacheRoot();
  const resolved = path.resolve(cacheRoot, ...segments);
  // Containment check
  if (!resolved.startsWith(cacheRoot + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  // ... read and serve file
}
```

**Parameter type:** `{ segments: string[] }` — each path component is a separate array element. Next.js URL-decodes each segment automatically.

### Pattern 2: Sub-Path Filename Validation

**What:** Replace the UUID-only regex with a regex that accepts the new sub-path format (`YYYY-MM/images/name-uuid8.ext` or `YYYY-MM/files/name-uuid8.ext`).

**Current regex (rejecting new format):**
```typescript
// OLD — UUID v4 only, rejects sub-paths
const SAFE_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i;
```

**New regex (accepting sub-paths):**
```typescript
// NEW — validates full sub-path: YYYY-MM/type/filename.ext
// Allows Unicode filenames (Chinese chars preserved in file-utils.ts)
const SAFE_SUBPATH_RE =
  /^\d{4}-\d{2}\/(images|files)\/[^/]+\.(jpg|jpeg|png|gif|webp)$/i;
```

This regex appears in two files:
- `src/app/api/internal/cache/[...segments]/route.ts` — validates the joined `segments.join("/")`
- `src/lib/build-multimodal-prompt.ts` — validates each filename before resolving to absolute path
- `src/app/api/internal/assistant/chat/route.ts` — `IMAGE_FILENAME_RE` validates incoming `imageFilenames` array elements

### Pattern 3: buildMultimodalPrompt with Sub-Path Filenames

**What:** The function currently treats `imageFilenames` as bare filenames joined to `cacheDir`. After Phase 44, they are sub-paths joined to `getAssistantCacheRoot()`.

**Current call site (chat/route.ts line 106):**
```typescript
// Already passes getAssistantCacheRoot() — correct base
buildMultimodalPrompt(prompt, safeImageFilenames, getAssistantCacheRoot())
```

**Current function implementation (needs update):**
```typescript
// OLD: validates as UUID v4 flat filename
.filter((filename) => SAFE_FILENAME_RE.test(filename))
.map((filename) => path.resolve(cacheDir, filename))  // cacheDir = cacheRoot

// NEW: validates as sub-path, joins to cacheRoot
.filter((subPath) => SAFE_SUBPATH_RE.test(subPath))
.map((subPath) => path.resolve(cacheDir, subPath))    // same join, different validation
```

The `path.resolve(cacheDir, subPath)` call already works correctly for sub-paths when `cacheDir = getAssistantCacheRoot()` — `path.resolve` handles forward slashes in the second argument correctly on all platforms. Only the validation regex needs to change.

### Pattern 4: Old Flat Cache File Deletion

**What:** Two UUID-named flat files exist in `data/cache/assistant/` root that must be deleted (no backward compatibility per STATE.md).

**Files found:**
- `data/cache/assistant/b415b3ca-3fe4-4260-8d1c-bfb69ef4d42f.png`
- `data/cache/assistant/da7798ca-4ab2-4d26-b183-7ee02f60ddad.png`

**Approach:** Simple `fs.rmSync` in a one-time migration script or inline in a plan task. Since this is a dev environment with no users, deletion is unconditional — no backup needed.

### Anti-Patterns to Avoid

- **Reusing `[filename]` route folder alongside `[...segments]`:** Next.js will have route conflicts. The old `[filename]` directory must be removed entirely.
- **Checking containment with `startsWith(cacheRoot)` (no trailing sep):** A directory named `assistant-evil` would pass. Always use `cacheRoot + path.sep`.
- **URL-encoding segments manually:** Next.js decodes segment values automatically. Joining with `/` after decoding gives the correct sub-path. Do not double-encode.
- **Changing `buildMultimodalPrompt` signature:** The call site in `chat/route.ts` already passes `getAssistantCacheRoot()` as `cacheDir`. No signature change is needed — only the internal validation regex changes.
- **Updating tests with old UUID fixtures:** The test file `build-multimodal-prompt.test.ts` uses UUID v4 format fixtures. Tests must be updated to use the new sub-path format after the regex changes, or the test will falsely pass by accidentally testing the wrong validation path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path traversal prevention | Custom string sanitizer | `path.resolve()` + `startsWith(root + sep)` | Already the project pattern; handles `..` segments, symlinks, and platform differences |
| Multi-segment URL routing | Middleware rewrite rules | Next.js `[...segments]` catch-all | Built-in, zero config, typed params |
| File deletion | Complex migration script | `fs.rmSync(path, { force: true })` | Two files, one-time op |

## Runtime State Inventory

> Included because this phase involves path structure change affecting stored filenames.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Two flat UUID files in `data/cache/assistant/`: `b415b3ca-...png`, `da7798ca-...png` | Delete (rmSync) — no backward compatibility |
| Live service config | None — no external services reference cache paths | None |
| OS-registered state | None | None |
| Secrets/env vars | None — cache path is computed from `process.cwd()` | None |
| Build artifacts | None | None |

**sessionStorage image cache:** `assistant-provider.tsx` stores `imageFilenames` in sessionStorage under key `"assistant-image-cache"`. If any existing browser session has cached the old UUID format filenames, those entries will fail to load images after the route change. Since there are no users and this is dev stage, clearing sessionStorage is not a migration concern — old sessions simply show broken images for pre-existing chats.

## Common Pitfalls

### Pitfall 1: Route Conflict After Rename
**What goes wrong:** If the old `[filename]` directory is not deleted before creating `[...segments]`, Next.js may produce a route conflict error at build/startup.
**Why it happens:** Next.js detects overlapping routes and errors.
**How to avoid:** Delete `src/app/api/internal/cache/[filename]/` entirely before creating `src/app/api/internal/cache/[...segments]/`.
**Warning signs:** `Error: Conflicting routes` in `pnpm dev` output.

### Pitfall 2: SAFE_SUBPATH_RE Rejecting Chinese Filenames
**What goes wrong:** A regex like `[a-zA-Z0-9_\-]+` in the filename portion would strip Chinese characters that are explicitly preserved by `buildCacheFilename`.
**Why it happens:** ASCII-only character class.
**How to avoid:** The filename portion of the regex should use `[^/]+` (any char except slash) to allow Unicode. Containment check via `path.resolve` + `startsWith` provides the real security boundary.
**Warning signs:** Image upload succeeds, but sending the message produces no images in the prompt (all filtered out).

### Pitfall 3: buildMultimodalPrompt Test Fixtures Still Use Old UUID Format
**What goes wrong:** Existing tests in `src/lib/__tests__/build-multimodal-prompt.test.ts` use UUID v4 format constants (`UUID1`, `UUID2`, etc.). After updating `SAFE_FILENAME_RE` to the sub-path format, these tests will fail because the fixtures no longer match the new regex.
**Why it happens:** Tests were written for the old flat filename format.
**How to avoid:** Update test fixtures to use `"2026-04/images/a1b2c3d4-e5f6-7890-abcd-ef1234567890.png"` sub-path format. Also update the `cacheDir` in tests from `/abs/cache` to a `cacheRoot` that the sub-path resolves into correctly.
**Warning signs:** All tests in `build-multimodal-prompt.test.ts` fail after the regex change.

### Pitfall 4: Double-Decoding Chinese Filenames in Route
**What goes wrong:** Manually calling `decodeURIComponent` on segments that Next.js already decoded produces double-decoding artifacts in Chinese filenames.
**Why it happens:** Next.js App Router automatically decodes URL-encoded path segments.
**How to avoid:** Use `segments` directly — do not call `decodeURIComponent` on them.
**Warning signs:** Filenames with Chinese characters appear garbled in `path.resolve` result.

### Pitfall 5: Missing Containment Check with Merged Segments
**What goes wrong:** Joining segments without validation allows path traversal: `["..","..","etc","passwd"]` resolves outside `data/cache/assistant/`.
**Why it happens:** Catch-all routes accept any number of segments including `..`.
**How to avoid:** Always call `path.resolve(cacheRoot, ...segments)` and verify result `startsWith(cacheRoot + path.sep)` before reading.
**Warning signs:** Security test shows `../../../etc/passwd` bypasses the route.

## Code Examples

Verified patterns from codebase inspection:

### Catch-All Route Handler
```typescript
// src/app/api/internal/cache/[...segments]/route.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { MIME_MAP } from "@/lib/file-serve";
import { getAssistantCacheRoot } from "@/lib/file-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Validates the reconstructed sub-path: YYYY-MM/(images|files)/filename.ext
// [^/]+ allows Unicode (Chinese filenames), rejects empty segments and slashes
const SUBPATH_RE =
  /^\d{4}-\d{2}\/(images|files)\/[^/]+\.(jpg|jpeg|png|gif|webp)$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ segments: string[] }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { segments } = await params;
  const subPath = segments.join("/");

  if (!SUBPATH_RE.test(subPath)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const cacheRoot = getAssistantCacheRoot();
  const resolved = path.resolve(cacheRoot, subPath);

  if (!resolved.startsWith(cacheRoot + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(resolved);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Read error" }, { status: 500 });
  }

  const ext = path.extname(subPath).toLowerCase();
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
```

### Updated buildMultimodalPrompt (SAFE_FILENAME_RE → SAFE_SUBPATH_RE)
```typescript
// src/lib/build-multimodal-prompt.ts — only regex changes
const SAFE_SUBPATH_RE =
  /^\d{4}-\d{2}\/(images|files)\/[^/]+\.(jpg|jpeg|png|gif|webp)$/i;

// In the filter pipeline — same path.resolve call, different validation
const validPaths = filenames
  .filter((subPath) => SAFE_SUBPATH_RE.test(subPath))
  .map((subPath) => path.resolve(cacheDir, subPath))
  .filter((absPath) => {
    if (!absPath.startsWith(cacheDirNorm + path.sep)) return false;
    return fs.existsSync(absPath);
  });
```

### Updated IMAGE_FILENAME_RE in chat route
```typescript
// src/app/api/internal/assistant/chat/route.ts
const IMAGE_FILENAME_RE =
  /^\d{4}-\d{2}\/(images|files)\/[^/]+\.(jpg|jpeg|png|gif|webp)$/i;
```

### Frontend URL Construction (no change needed)
```typescript
// src/components/assistant/assistant-chat-bubble.tsx — MessageImage
// filename is already a sub-path like "2026-04/images/设计稿-a1b2c3d4.png"
// returned by /api/internal/assistant/images POST response
const url = `/api/internal/cache/${filename}`;
// produces: /api/internal/cache/2026-04/images/设计稿-a1b2c3d4.png
// No code change required here — the sub-path passes through naturally
```

### Old Cache File Cleanup
```typescript
// One-time cleanup — delete flat UUID files from assistant cache root
import * as fs from "node:fs";
import * as path from "node:path";

const cacheRoot = path.join(process.cwd(), "data", "cache", "assistant");
const entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
for (const entry of entries) {
  if (entry.isFile()) {
    // Flat files (not in subdirectories) are the old format — delete
    fs.rmSync(path.join(cacheRoot, entry.name), { force: true });
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `[filename]` single-segment route | `[...segments]` catch-all route | Phase 45 | Supports nested `year-month/type/` paths |
| UUID v4 flat filename | `YYYY-MM/type/name-uuid8.ext` sub-path | Phase 44 | Human-readable, organized by date |
| UUID-only validation regex | Sub-path format regex | Phase 45 | Accepts new file naming convention |

## Open Questions

1. **Route directory rename vs. file move**
   - What we know: Next.js routes map 1:1 to directories. `[filename]` must become `[...segments]`.
   - What's unclear: Git tracks files not directories — the move will appear as a file delete+create which is fine, but the old route will 404 until the new one is deployed.
   - Recommendation: Delete `[filename]/route.ts` and create `[...segments]/route.ts` as a single atomic operation in one plan task.

2. **containment check against cacheRoot with path.sep**
   - What we know: `getAssistantCacheRoot()` returns the path WITHOUT a trailing separator.
   - What's unclear: On Windows, `path.sep` is `\` but forward-slash sub-paths work in `path.resolve`. This is a macOS dev environment.
   - Recommendation: Use `cacheRoot + path.sep` as the prefix exactly as done in the existing `[filename]` route — same pattern, already works.

## Environment Availability

Step 2.6: SKIPPED (no external tool dependencies — all changes are code/config edits within the Next.js project).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (project standard) |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run --reporter=verbose src/lib/__tests__/build-multimodal-prompt.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROUTE-01 | Catch-all route resolves `2026-04/images/foo.png` sub-path | unit (route handler logic) | `pnpm test:run --reporter=verbose src/app/api/internal/cache` | ❌ Wave 0 |
| ROUTE-02 | Frontend URL `${filename}` produces correct path (no code change needed) | manual verify | visual inspection of dev server | n/a — no code change |
| ROUTE-03 | `buildMultimodalPrompt` resolves sub-path filenames to correct absolute paths | unit | `pnpm test:run --reporter=verbose src/lib/__tests__/build-multimodal-prompt.test.ts` | ✅ (needs fixture update) |

### Sampling Rate
- **Per task commit:** `pnpm test:run`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/app/api/internal/cache/[...segments]/__tests__/route.test.ts` — covers ROUTE-01 (catch-all route handler: valid sub-path returns 200, traversal attempt returns 400, unknown path returns 404)
- [ ] Update fixtures in `src/lib/__tests__/build-multimodal-prompt.test.ts` — UUID v4 constants → sub-path format strings to match new `SAFE_SUBPATH_RE`

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/app/api/internal/cache/[filename]/route.ts` — current route implementation
- Direct codebase inspection: `src/lib/build-multimodal-prompt.ts` — current validation and path logic
- Direct codebase inspection: `src/lib/file-utils.ts` — `getAssistantCacheRoot()`, `getAssistantCacheDir()`, `buildCacheFilename()`
- Direct codebase inspection: `src/app/api/internal/assistant/images/route.ts` — confirmed sub-path returned as `filename` in upload response
- Direct codebase inspection: `src/app/api/internal/assistant/chat/route.ts` — `IMAGE_FILENAME_RE` validation and `buildMultimodalPrompt` call site
- Direct codebase inspection: `src/components/assistant/assistant-chat-bubble.tsx` — MessageImage URL construction
- Direct codebase inspection: `src/components/assistant/assistant-provider.tsx` — imageFilenames flow through sendChatMessage
- Direct filesystem inspection: `data/cache/assistant/` — 2 flat UUID files confirmed present

### Secondary (MEDIUM confidence)
- Next.js App Router catch-all route convention `[...segments]` — well-established pattern, `params.segments: string[]`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all changes are within the existing project stack, no new dependencies
- Architecture: HIGH — codebase fully inspected, all touch points identified
- Pitfalls: HIGH — identified from direct code reading of validation regexes and route structure

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable Next.js App Router conventions)
