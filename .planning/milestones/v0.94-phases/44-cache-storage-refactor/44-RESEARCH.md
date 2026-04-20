# Phase 44: Cache Storage Refactor - Research

**Researched:** 2026-04-20
**Domain:** Node.js file system, filename sanitization, cache directory structure
**Confidence:** HIGH

## Summary

Phase 44 restructures the assistant image cache from a flat UUID-only layout (`data/cache/assistant/<uuid>.ext`) to a hierarchical year-month/type layout (`data/cache/assistant/2026-04/images/<readable-name>-<8char-uuid>.ext`). The change is entirely server-side and confined to two files: `src/lib/file-utils.ts` (directory logic) and `src/app/api/internal/assistant/images/route.ts` (filename generation). The `buildMultimodalPrompt` and cache-serve route are NOT changed in this phase — that is Phase 45's scope.

The key design decisions are: (1) detect "meaningless" filenames using a small sentinel list and produce a `tower_image-{uuid}` fallback; (2) sanitize filenames by preserving Chinese characters and alphanumerics while replacing spaces and special characters with `_`; (3) the 8-char UUID suffix is a slice of `crypto.randomUUID()` (first 8 hex chars), which is sufficient for collision avoidance within a directory; (4) `getAssistantCacheDir(type)` becomes a parameterized function that accepts `"images"` (default) or `"files"` (future), returns the full `year-month/type` path, and creates it if absent.

**Primary recommendation:** Modify `file-utils.ts` to add a typed `getAssistantCacheDir(type?)` with auto-mkdir, then update `images/route.ts` to derive a readable filename from `file.name` using the sanitize/fallback rules, and return a relative sub-path (e.g., `2026-04/images/name-uuid.png`) so the caller receives the full sub-path, not just a bare filename.

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
| DIR-01 | 上传图片存储到 `data/cache/assistant/{year-month}/images/` 年月分组目录 | `getAssistantCacheDir()` must append `YYYY-MM/images/` from `new Date()` |
| DIR-02 | 缓存目录支持类型子目录（`images/`），为未来文件类型扩展预留 `files/` 结构 | Function must accept a `type` param (`"images"` | `"files"`) so sibling dirs are trivially addable |
| DIR-03 | `getAssistantCacheDir()` 自动生成当前年月 + 类型的完整路径 | Function must call `fs.mkdirSync(..., { recursive: true })` internally, removing need for separate `ensureAssistantCacheDir()` |
| NAME-01 | 复制系统文件粘贴时，保留原始文件名，格式为 `{原始名}-{8位uuid}.{ext}` | Read `file.name` from FormData, sanitize, append `-{8}` from `crypto.randomUUID().replace(/-/g, "").slice(0, 8)` |
| NAME-02 | 截图或无意义文件名（如 `image.png`）时，使用 `tower_image-{8位uuid}.{ext}` | Sentinel pattern check against a short list of meaningless stems; produce `tower_image-{8char}.ext` |
| NAME-03 | 文件名清洗：保留中文和英文字母数字，空格和特殊字符替换为 `_` | Regex replace: strip extension, apply `/[^\p{L}\p{N}]/gu` replacement (or equivalent allowlist) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

| Directive | Source |
|-----------|--------|
| Use pnpm as package manager | CLAUDE.md |
| App Router routes must have `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"` | CLAUDE.md |
| All internal API routes must call `requireLocalhost(request)` | `.claude/rules/security.md` |
| Path-traversal containment check required on every resolved file path | Existing pattern in cache route + security rules |
| No `console.log` in production code | `.claude/rules/typescript/hooks.md` |
| All user-facing strings via `t("key")` | CLAUDE.md |
| Immutable patterns — no mutation | `.claude/rules/common/coding-style.md` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` | built-in | Directory creation, file write | Already used throughout codebase |
| `node:path` | built-in | Path joining, extension extraction | Already used throughout codebase |
| `node:crypto` | built-in | `randomUUID()` for UUID generation | Already used in images route |

### No new dependencies required
This phase is pure standard Node.js + existing codebase utilities. No npm installs needed.

## Architecture Patterns

### Recommended File Changes

```
src/lib/file-utils.ts              # Primary change — new getAssistantCacheDir(type?) signature
src/app/api/internal/
  assistant/images/route.ts       # Filename generation logic
src/lib/__tests__/
  file-utils.test.ts              # New test file (Wave 0 gap)
```

No other files change in Phase 44. Route/frontend adaptation is Phase 45.

### Pattern 1: Parameterized cache dir function

```typescript
// Source: existing codebase conventions in file-utils.ts
export type CacheFileType = "images" | "files";

export function getAssistantCacheDir(type: CacheFileType = "images"): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(DATA_ROOT, "cache", "assistant", ym, type);
  assertWithinDataRoot(dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```

**Key point:** The old `ensureAssistantCacheDir()` is no longer needed — creation is baked into `getAssistantCacheDir()`. The old function can be removed; the cache serve route only calls `getAssistantCacheDir()` (no `ensure` variant). Phase 44 does NOT change the cache serve route — it still uses the old flat path. Phase 45 will update the route to a catch-all.

### Pattern 2: Filename sanitization

```typescript
// Meaningless filename stems — triggers tower_image fallback (NAME-02)
const MEANINGLESS_STEMS = new Set([
  "image",
  "screenshot",
  "img",
  "photo",
  "picture",
  "clipboard",
  "paste",
  "untitled",
]);

// Strip extension, check if meaningless, then sanitize
function buildCacheFilename(originalName: string, ext: string): string {
  const stem = path.basename(originalName, path.extname(originalName));
  const uuid8 = crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  // Screenshot or meaningless name check (NAME-02)
  // Also covers "Screenshot 2026-04-20 at 12.34.56" style names
  const stemLower = stem.toLowerCase();
  const isMeaningless =
    MEANINGLESS_STEMS.has(stemLower) ||
    /^screenshot[\s_-]/i.test(stem);

  if (isMeaningless) {
    return `tower_image-${uuid8}${ext}`;
  }

  // NAME-03: preserve Chinese + alphanumerics, replace everything else with _
  // Use Unicode property escapes — supported in Node.js 10+ / V8
  const sanitized = stem
    .replace(/[^\p{L}\p{N}]/gu, "_")   // replace non-letter/non-digit with _
    .replace(/_+/g, "_")               // collapse multiple underscores
    .replace(/^_|_$/g, "");            // trim leading/trailing _

  const safeStem = sanitized || "file"; // fallback if stem is entirely special chars

  return `${safeStem}-${uuid8}${ext}`;
}
```

**Unicode note:** `\p{L}` matches any Unicode letter (includes Chinese characters). `\p{N}` matches any Unicode digit. This naturally satisfies NAME-03: Chinese preserved, spaces and special chars become `_`. The `u` flag is required for Unicode property escapes — confirmed supported in Node.js 12+.

### Pattern 3: Upload route returns sub-path, not bare filename

The images route must return the sub-path relative to the assistant cache root so the frontend can construct the full URL in Phase 45. In Phase 44, the returned value changes from `filename` (bare UUID) to a `cachePath` (e.g., `"2026-04/images/设计稿-a1b2c3d4.png"`).

```typescript
// In images/route.ts (Phase 44 change)
const dir = getAssistantCacheDir("images");  // creates dir, returns absolute path
const filename = buildCacheFilename(file.name, ext);
const dest = path.join(dir, filename);

// Containment check still required
if (!dest.startsWith(dir + path.sep) && dest !== dir) {
  return NextResponse.json({ error: "Invalid path" }, { status: 400 });
}

await fs.promises.writeFile(dest, buffer);

// Return sub-path relative to assistant cache root (used by Phase 45 routing)
const assistantRoot = path.join(process.cwd(), "data", "cache", "assistant");
const cachePath = path.relative(assistantRoot, dest);
return NextResponse.json({ filename: cachePath, mimeType });
```

**Why `filename` key is kept:** The `use-image-upload.ts` hook reads `data.filename` — keeping the key name avoids touching frontend code in this phase. The value changes from `"<uuid>.png"` to `"2026-04/images/<name>-<uuid>.png"`.

### Pattern 4: Containment check with nested dir

The current containment check in `images/route.ts` uses `dir + path.sep`. With nested directories, `dir` now points deeper (e.g., `.../assistant/2026-04/images/`) — the check is still correct as-is. No changes needed to the logic, only the `dir` value changes.

### Anti-Patterns to Avoid

- **Using `encodeURIComponent` on Chinese filenames:** Chinese characters are valid in POSIX filenames. Do not encode them. Store the raw UTF-8 name.
- **Using full UUID for suffix:** 8 chars is sufficient for collision avoidance within a single `year-month/type/` directory. Full UUID makes filenames ugly.
- **Date string in `getAssistantCacheDir()` as argument:** The year-month should be computed inside the function at call time, not passed by caller. Callers should not manage date formatting.
- **Keeping `ensureAssistantCacheDir()` as separate function:** Merge creation into `getAssistantCacheDir()`. The old pattern of having a separate `ensure*` variant was a pre-44 workaround; DIR-03 mandates auto-creation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unicode-aware char classification | Custom char-code range checks | `\p{L}\p{N}` regex with `u` flag | Native V8 Unicode property escapes — correct for all scripts |
| Unique ID generation | Random number math | `crypto.randomUUID()` | Already used in codebase; cryptographically random; collision rate ~1 in 4 billion per 8 chars |
| Directory creation | Manual `mkdir` with existence check | `fs.mkdirSync(dir, { recursive: true })` | Idempotent, race-safe; already used in codebase |

## Common Pitfalls

### Pitfall 1: Month padding
**What goes wrong:** `new Date().getMonth()` returns 0-11 (January = 0). Without padding, April produces `2026-4` instead of `2026-04`.
**Why it happens:** JS `Date.getMonth()` is 0-indexed.
**How to avoid:** Always `String(now.getMonth() + 1).padStart(2, "0")`.
**Warning signs:** Directory names like `2026-4/` in the filesystem.

### Pitfall 2: Empty sanitized stem
**What goes wrong:** If a filename is entirely composed of special characters (e.g., `!!!.png`), sanitization produces an empty string, leading to `-a1b2c3d4.png` with a leading dash.
**Why it happens:** Regex replaces all chars, trims underscores, leaves empty.
**How to avoid:** Add a final fallback `const safeStem = sanitized || "file"`.

### Pitfall 3: Containment check with new nested dir
**What goes wrong:** If `dir` ends with `path.sep`, the check `dest.startsWith(dir + path.sep)` can fail for files directly in `dir`.
**Why it happens:** Double separator.
**How to avoid:** Use `path.resolve()` for both sides of the check, same pattern as existing code. `getAssistantCacheDir()` already uses `assertWithinDataRoot()` — the belt-and-suspenders check in `images/route.ts` uses `dir + path.sep` which works correctly as long as `dir` does NOT end with a separator (Node's `path.join` never adds trailing sep).

### Pitfall 4: Breaking the cache serve route (Phase 45 scope)
**What goes wrong:** If Phase 44 changes the returned `filename` value to a sub-path but the cache route still expects a bare UUID filename, the regex `FILENAME_RE` will reject it and return 400.
**Why it happens:** The cache route in Phase 44 scope is NOT changed — it still validates against the old UUID-only regex. Images uploaded after Phase 44 will have sub-path filenames but the serve route cannot handle sub-paths.
**How to avoid:** This is the **known cross-phase dependency**. Phase 44 changes storage only. Phase 45 updates the serve route to a catch-all. The planner must note this: the assistant chat bubble will show broken images between Phase 44 and Phase 45 deployment. Since this is dev stage with no real users, this is acceptable.

### Pitfall 5: `file.name` is empty or missing on some browsers
**What goes wrong:** Clipboard paste items (DataTransfer API) may produce File objects with name `""` or `"image.png"` depending on the browser and paste source.
**Why it happens:** Browser behavior varies for screenshot pastes.
**How to avoid:** Treat empty stem after sanitization the same as meaningless stem — fall back to `tower_image-{uuid}`.

## Code Examples

### Complete `buildCacheFilename` helper (verified pattern)

```typescript
// Source: codebase conventions + Node.js built-ins
import * as crypto from "node:crypto";
import * as path from "node:path";

const MEANINGLESS_STEMS = new Set([
  "image", "screenshot", "img", "photo", "picture",
  "clipboard", "paste", "untitled",
]);

export function buildCacheFilename(originalName: string, ext: string): string {
  const stem = path.basename(originalName, path.extname(originalName));
  const uuid8 = crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  const stemLower = stem.toLowerCase();
  const isMeaningless =
    !stem ||
    MEANINGLESS_STEMS.has(stemLower) ||
    /^screenshot[\s_\-]/i.test(stem);

  if (isMeaningless) {
    return `tower_image-${uuid8}${ext}`;
  }

  const sanitized = stem
    .replace(/[^\p{L}\p{N}]/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const safeStem = sanitized || "file";
  return `${safeStem}-${uuid8}${ext}`;
}
```

### Updated `getAssistantCacheDir` (verified pattern)

```typescript
// Replaces both getAssistantCacheDir() and ensureAssistantCacheDir() from file-utils.ts
export type CacheFileType = "images" | "files";

export function getAssistantCacheDir(type: CacheFileType = "images"): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(DATA_ROOT, "cache", "assistant", ym, type);
  assertWithinDataRoot(dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | 2 existing flat-path files in `data/cache/assistant/` (`b415b3ca-...png`, `da7798ca-...png`) | No migration — STATE.md confirms "旧 cache 数据向后兼容 — 开发阶段无用户，旧文件直接清除". Delete them or leave; serve route will 404 harmlessly. |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None — no env vars reference cache paths | None |
| Build artifacts | None | None |

**Existing stale files:** `data/cache/assistant/b415b3ca-3fe4-4260-8d1c-bfb69ef4d42f.png` and `da7798ca-4ab2-4d26-b183-7ee02f60ddad.png` — per STATE.md decision, backward compatibility is explicitly NOT required. These can be left in place or manually deleted; they will simply 404 once Phase 45 updates the serve route.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (vitest.config.ts present) |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run --reporter=verbose src/lib/__tests__/file-utils.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIR-01 | `getAssistantCacheDir("images")` returns path containing current year-month | unit | `pnpm test:run src/lib/__tests__/file-utils.test.ts` | Wave 0 |
| DIR-02 | `getAssistantCacheDir("files")` returns sibling `files/` path | unit | `pnpm test:run src/lib/__tests__/file-utils.test.ts` | Wave 0 |
| DIR-03 | `getAssistantCacheDir()` creates directory if absent | unit (mock fs) | `pnpm test:run src/lib/__tests__/file-utils.test.ts` | Wave 0 |
| NAME-01 | `buildCacheFilename("设计稿.png", ".png")` → `"设计稿-{8}.png"` | unit | `pnpm test:run src/lib/__tests__/file-utils.test.ts` | Wave 0 |
| NAME-02 | `buildCacheFilename("image.png", ".png")` → `"tower_image-{8}.png"` | unit | `pnpm test:run src/lib/__tests__/file-utils.test.ts` | Wave 0 |
| NAME-03 | `buildCacheFilename("my file!.png", ".png")` → `"my_file-{8}.png"` | unit | `pnpm test:run src/lib/__tests__/file-utils.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:run src/lib/__tests__/file-utils.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/lib/__tests__/file-utils.test.ts` — covers DIR-01, DIR-02, DIR-03, NAME-01, NAME-02, NAME-03

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code changes to existing Node.js server-side utilities. No external dependencies beyond the existing Next.js/Node.js runtime.

## Sources

### Primary (HIGH confidence)
- Codebase: `src/lib/file-utils.ts` — existing `getAssistantCacheDir()` signature and `assertWithinDataRoot()` pattern
- Codebase: `src/app/api/internal/assistant/images/route.ts` — current upload flow, `file.name`, containment check
- Codebase: `src/app/api/internal/cache/[filename]/route.ts` — current serve route (Phase 45 changes this)
- Codebase: `src/hooks/use-image-upload.ts` — `data.filename` consumption (must stay key-compatible)
- Codebase: `src/components/assistant/assistant-chat-bubble.tsx` — `/api/internal/cache/${filename}` URL construction (Phase 45 scope)
- Codebase: `.planning/STATE.md` — "backward compatibility NOT required, dev stage"
- Node.js docs (built-in): `crypto.randomUUID()`, `fs.mkdirSync()`, `path.join()` — all stable APIs

### Secondary (MEDIUM confidence)
- MDN / ECMAScript spec: Unicode property escapes `\p{L}\p{N}` with `u` flag — supported V8/Node.js 10+

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; pure built-ins already in use
- Architecture: HIGH — full codebase read; all touch-points identified
- Pitfalls: HIGH — common Node.js date/path gotchas well-understood; cross-phase dependency explicitly noted

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable domain — Node.js built-ins do not change)
