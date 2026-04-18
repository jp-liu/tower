# Phase 40: Image Upload API - Research

**Researched:** 2026-04-18
**Domain:** Next.js App Router file upload, magic-byte MIME validation, static file serving
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Upload API Design**
- POST endpoint at `/api/internal/assistant/images` using Next.js App Router route handler
- Accept `multipart/form-data` with a single `file` field (consistent with existing `uploadAsset` pattern in `asset-actions.ts`)
- Return `{ filename, mimeType }` on success — filename is the UUID-based name, not the original
- Apply `requireLocalhost()` guard (per security rules for all `/api/internal/` routes)

**File Storage**
- Store in `data/cache/assistant/<uuid>.<ext>` — new subdirectory under existing `data/cache/`
- Use `crypto.randomUUID()` for filename generation (Node.js built-in, no extra dependency)
- Extension derived from validated MIME type (not from original filename) — e.g., `image/jpeg` → `.jpg`
- Add `ensureAssistantCacheDir()` and `getAssistantCacheDir()` helpers to `file-utils.ts`

**MIME Validation**
- Validate via magic bytes (file signature), not `Content-Type` header or file extension
- Allowed types: `image/jpeg`, `image/png`, `image/gif`, `image/webp` (per CACHE-02)
- Read first 12 bytes to check known signatures (JPEG `FF D8 FF`, PNG `89 50 4E 47`, GIF `47 49 46`, WEBP `52 49 46 46...57 45 42 50`)
- Reject with 400 `{ error: "Unsupported file type" }` if magic bytes don't match

**Path Traversal Protection**
- Use `path.resolve()` + containment check against `data/cache/assistant/` (same pattern as `assertWithinDataRoot` in `file-utils.ts`)
- UUID-generated filenames inherently prevent traversal — original filename is never used in storage path
- Double-check: resolved path must start with the assistant cache directory

**Static File Serving**
- Serve cached images via `/api/internal/cache/[filename]/route.ts` GET handler
- Serve project assets via `/api/internal/assets/[filename]/route.ts` GET handler
- Both routes: `requireLocalhost()`, validate filename format, read from filesystem, return with correct `Content-Type`
- Set `Cache-Control: private, max-age=3600` for browser caching
- Return 404 for missing files

### Claude's Discretion
- Max upload size: use existing `system.maxUploadBytes` config (default 50MB) — images are typically small, but reuse existing pattern
- Error response format: `{ error: string }` consistent with other internal API routes

### Deferred Ideas (OUT OF SCOPE)
- Non-image file support (FILE-01) — future milestone
- Drag-and-drop upload (FILE-02) — future milestone
- Auto cache cleanup (FILE-03) — explicitly out of scope per REQUIREMENTS.md
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CACHE-01 | User can paste image in chat input, image uploads to `data/cache/assistant/<uuid>.<ext>` | POST route + `ensureAssistantCacheDir()` + UUID filename generation covers storage |
| CACHE-02 | Upload API validates MIME type (image/jpeg, image/png, image/gif, image/webp only) | Magic-byte validation utility — 12-byte header read covers all four types |
| CACHE-03 | Upload API includes path traversal protection | `path.resolve()` + containment check mirrors `assertWithinDataRoot`; UUID filenames eliminate original-name attack surface |
| CACHE-04 | Cached images accessible via short path `/cache/<filename>` | GET route at `/api/internal/cache/[filename]/route.ts` + existing `MIME_MAP` in `file-serve.ts` |
| CACHE-05 | Project assets accessible via short path `/assets/<filename>` | GET route at `/api/internal/assets/[filename]/route.ts` reusing same static-serve pattern |
</phase_requirements>

---

## Summary

Phase 40 is a pure server-side phase: one upload POST route, one cache-serving GET route, and one assets-serving GET route, plus two helper functions added to `file-utils.ts`. The codebase already has every building block — `requireLocalhost()`, `MIME_MAP`, `resolveAssetPath()` pattern, `assertWithinDataRoot()`, and a working example in `uploadAsset()`. This phase is primarily assembly and specialisation, not invention.

The one genuinely new piece is magic-byte MIME validation. The existing `uploadAsset()` trusts `file.type` (the browser-supplied MIME), which is a well-known XSS vector for SVG-disguised-as-PNG. This phase fixes that by reading the first 12 bytes of the buffer and comparing against known signatures. The logic is simple enough to inline but should be extracted into a standalone utility (`src/lib/mime-magic.ts`) so Phase 43 (AI integration) can reuse it without importing the whole upload route.

The static serving routes reuse `MIME_MAP` and `resolveAssetPath`-style containment checks already present in `src/lib/file-serve.ts`. The only difference is the base directory (`data/cache/assistant/` vs `data/assets/<projectId>/`) and the addition of `Cache-Control: private, max-age=3600`.

**Primary recommendation:** Implement magic-byte validation as a standalone utility first, then wire up the three route handlers using the existing guard/serve patterns. No new npm packages are required.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` (App Router) | 15.x (project pinned) | Route handlers for POST upload + GET serve | Already in use; `export const runtime = "nodejs"` unlocks Node fs APIs |
| `node:fs/promises` | Node 22 built-in | Async file write/read | Already used throughout `file-utils.ts` |
| `node:path` | Node 22 built-in | Path resolution + containment check | Used in `file-utils.ts` and `file-serve.ts` |
| `node:crypto` | Node 22 built-in | `randomUUID()` for collision-free filenames | No external dep; already available |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | project pinned | Filename format validation (UUID regex) | Already imported in most route handlers |
| `src/lib/internal-api-guard` | local | `requireLocalhost()` | All `/api/internal/` routes — mandatory |
| `src/lib/file-serve` | local | `MIME_MAP`, `resolveAssetPath` pattern | Reuse for static GET routes |
| `src/actions/config-actions` | local | `getConfigValue("system.maxUploadBytes", 52428800)` | Already used by `uploadAsset()` for size limit |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled magic bytes | `file-type` npm package | `file-type` covers 300+ types but adds a dependency; only 4 types needed here — inline is fine |
| UUID filename | Original filename sanitised | UUID eliminates all traversal and collision edge cases; original filename is never trustworthy |
| `Cache-Control: private, max-age=3600` | No cache header | Images are immutable by UUID; caching reduces repeated reads without stale-content risk |

**Installation:** No new packages required. All dependencies are built-in or already in `package.json`.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   ├── file-utils.ts          # ADD: getAssistantCacheDir(), ensureAssistantCacheDir()
│   ├── file-serve.ts          # EXISTING: MIME_MAP, resolveAssetPath pattern — reuse
│   └── mime-magic.ts          # NEW: detectImageMime(buffer) utility
└── app/api/internal/
    ├── assistant/
    │   └── images/
    │       └── route.ts       # NEW: POST /api/internal/assistant/images
    ├── cache/
    │   └── [filename]/
    │       └── route.ts       # NEW: GET /api/internal/cache/[filename]
    └── assets/
        └── [filename]/
            └── route.ts       # NEW: GET /api/internal/assets/[filename]
```

### Pattern 1: Upload Route Handler (POST)

**What:** Multipart form-data handler following existing internal-API conventions.
**When to use:** All file-accepting internal endpoints.

```typescript
// src/app/api/internal/assistant/images/route.ts
// Source: mirrors src/actions/asset-actions.ts uploadAsset() + internal-api-guard pattern

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  // Size check using existing config key
  const maxBytes = await getConfigValue<number>("system.maxUploadBytes", 52428800);
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Magic-byte MIME validation — NOT file.type
  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  // UUID filename — original name never used
  const ext = MIME_TO_EXT[mimeType]; // { "image/jpeg": ".jpg", ... }
  const filename = `${crypto.randomUUID()}${ext}`;

  const dir = ensureAssistantCacheDir();
  const dest = path.join(dir, filename);
  // Containment double-check (UUID prevents traversal but belt-and-suspenders)
  if (!dest.startsWith(dir + path.sep) && dest !== dir) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  await fs.promises.writeFile(dest, buffer);
  return NextResponse.json({ filename, mimeType });
}
```

### Pattern 2: Magic-Byte MIME Detection

**What:** Read first 12 bytes to identify image format, ignoring browser-supplied metadata.
**When to use:** Any server-side file acceptance — never trust `file.type` for security-sensitive operations.

```typescript
// src/lib/mime-magic.ts
// Source: JPEG/PNG/GIF/WEBP signatures from file format specs (verified against
//   https://www.iana.org/assignments/media-types and format docs)

const SIGNATURES: Array<{ mime: string; check: (b: Buffer) => boolean }> = [
  {
    mime: "image/jpeg",
    check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    check: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "image/gif",
    check: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46,
  },
  {
    mime: "image/webp",
    // RIFF....WEBP — bytes 0-3 = "RIFF", bytes 8-11 = "WEBP"
    check: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

/** Returns MIME type string if buffer matches a supported image signature, else null. */
export function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  for (const sig of SIGNATURES) {
    if (sig.check(buffer)) return sig.mime;
  }
  return null;
}
```

### Pattern 3: Static File Serving (GET)

**What:** Read file from `data/cache/assistant/` or `data/assets/<projectId>/`, return bytes with correct `Content-Type`.
**When to use:** All internal static resource routes.

```typescript
// src/app/api/internal/cache/[filename]/route.ts
// Source: mirrors src/app/api/files/assets/[projectId]/[filename]/route.ts

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FILENAME_RE = /^[0-9a-f-]{36}\.(jpg|jpeg|png|gif|webp)$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { filename } = await params;
  if (!FILENAME_RE.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const dir = getAssistantCacheDir();
  const resolved = path.resolve(dir, filename);
  if (!resolved.startsWith(dir + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(resolved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Read error" }, { status: 500 });
  }

  const ext = path.extname(filename).toLowerCase();
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

### Pattern 4: `file-utils.ts` Additions

**What:** Two helper functions following the existing `getCacheDir` / `ensureCacheDir` pattern.

```typescript
// Additions to src/lib/file-utils.ts

export function getAssistantCacheDir(): string {
  const dir = path.join(DATA_ROOT, "cache", "assistant");
  assertWithinDataRoot(dir);
  return dir;
}

export function ensureAssistantCacheDir(): string {
  const dir = getAssistantCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```

### Anti-Patterns to Avoid

- **Trusting `file.type`:** Browser-supplied MIME type is attacker-controlled. An SVG with `file.type = "image/png"` passes extension checks but can carry JavaScript. Always use magic bytes.
- **Using original filename in storage path:** Even with `path.basename()` sanitisation, original filenames can be confusing, collision-prone, and culturally ambiguous. UUID eliminates all these issues.
- **Skipping `requireLocalhost()` on static GET routes:** The cache directory may contain user-uploaded content. These routes must remain localhost-only.
- **Not setting `Cache-Control` on immutable assets:** UUID filenames are stable references. Browsers should cache them to avoid repeated reads.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MIME type → extension mapping | Custom lookup object per file | `MIME_MAP` from `src/lib/file-serve.ts` (already covers all four types) | Consistent with existing asset serving |
| Path containment check | Custom string logic | `path.resolve()` + `startsWith(dir + sep)` — same pattern as `assertWithinDataRoot` | Handles symlinks, relative segments, trailing slashes |
| Request guard | Custom IP check | `requireLocalhost()` from `src/lib/internal-api-guard` | Multi-layer (forwarded headers + host header), already tested |
| Upload size limit | Hardcoded constant | `getConfigValue("system.maxUploadBytes", 52428800)` | User-configurable, consistent with `uploadAsset()` |

**Key insight:** Every building block for this phase already exists in the codebase. The task is wiring them together plus adding the one new thing (magic-byte validation) that `uploadAsset()` currently lacks.

---

## Common Pitfalls

### Pitfall 1: `path.join` vs `path.resolve` in containment checks

**What goes wrong:** Using `path.join(dir, filename).startsWith(dir)` without ensuring `dir` ends with `path.sep`. A directory named `/data/cache/assistant` would incorrectly accept paths like `/data/cache/assistant-evil/file.png`.
**Why it happens:** String prefix matching on paths is deceptively fragile.
**How to avoid:** Check `resolved.startsWith(dir + path.sep)` — the existing `assertWithinDataRoot` already does this correctly. Mirror it exactly.
**Warning signs:** Tests pass for `../` traversal but miss sibling-directory attacks.

### Pitfall 2: WEBP magic bytes require checking bytes 8-11, not just 0-3

**What goes wrong:** Checking only `RIFF` signature (bytes 0-3) for WEBP allows other RIFF-container formats (AVI, WAV) to pass validation.
**Why it happens:** WEBP is a RIFF container; the actual `WEBP` identifier is at offset 8.
**How to avoid:** Check bytes 0-3 (`RIFF`) AND bytes 8-11 (`WEBP`). Buffer must be at least 12 bytes long — validate length before accessing indices.
**Warning signs:** A WAV audio file uploaded as `.webp` is accepted by validation.

### Pitfall 3: Next.js App Router body parsing configuration

**What goes wrong:** `request.formData()` may fail or return empty if Next.js is configured with a custom `bodyParser`. The default configuration for route handlers does NOT require manual body parser setup.
**Why it happens:** Confusion with Pages Router `/api/` conventions where you must disable `bodyParser`. In App Router, `request.formData()` works directly — no config needed.
**How to avoid:** Do not add `export const config = { api: { bodyParser: false } }` (that is a Pages Router pattern). App Router handlers call `await request.formData()` directly.
**Warning signs:** `formData.get("file")` returns `null` even when the request contains the field.

### Pitfall 4: Vitest `process.cwd()` mock scope

**What goes wrong:** Tests for `getAssistantCacheDir()` get the real project `data/cache/assistant/` directory instead of a temp directory, causing files to leak between test runs.
**Why it happens:** `process.cwd()` mock must be set up before the module is imported. If the module is imported at the top of the test file without mocking first, the real `DATA_ROOT` is captured at module load time.
**How to avoid:** Follow the same pattern as `file-utils.test.ts`: call `vi.spyOn(process, "cwd").mockReturnValue(tmpDir)` before the dynamic import, then clean up `tmpDir` in `afterAll`.
**Warning signs:** Tests leave files in real `data/` directory; tests pass locally but fail in CI.

---

## Code Examples

### Magic byte signatures (verified against format specifications)

```typescript
// JPEG: always starts with FF D8 FF
// Source: ISO/IEC 10918 (JFIF format), well-established — HIGH confidence
b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff

// PNG: 8-byte signature 89 50 4E 47 0D 0A 1A 0A
// Source: PNG spec §12.12 — checking first 4 bytes is sufficient for MIME detection
b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

// GIF: ASCII "GIF" (47 49 46)
// Source: GIF87a/GIF89a spec — first 3 bytes
b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46

// WEBP: RIFF container with WEBP FourCC at offset 8
// Source: WebP Container Specification (developers.google.com/speed/webp/docs/riff_container)
// bytes 0-3: "RIFF" (52 49 46 46), bytes 8-11: "WEBP" (57 45 42 50)
b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
```

### MIME type to extension map

```typescript
// Consistent with MIME_MAP in file-serve.ts
export const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};
```

### Filename validation regex for cache GET route

```typescript
// UUID v4 pattern + allowed extensions — prevents directory traversal and arbitrary filenames
const FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Trust `file.type` from browser | Magic-byte validation server-side | SVG XSS attack became well-known (~2015+) | Prevents SVG-as-PNG attacks carrying JavaScript |
| Pages Router `bodyParser: false` | App Router `request.formData()` directly | Next.js 13+ App Router | No extra config needed; simpler setup |
| `crypto.randomBytes(16).toString('hex')` for filenames | `crypto.randomUUID()` | Node.js 14.17+ | Built-in, standard UUID v4 format, no import needed |

**Deprecated/outdated:**
- `export const config = { api: { bodyParser: false } }`: Pages Router pattern — do NOT use in App Router route handlers.

---

## Open Questions

1. **Assets GET route scope**
   - What we know: `data/assets/<projectId>/` is the current structure; existing route is `/api/files/assets/[projectId]/[filename]`
   - What's unclear: The decision calls for `/api/internal/assets/[filename]` without a `projectId` segment — this implies serving assets from a flat namespace or requires knowing projectId up front
   - Recommendation: Serve from `data/assets/` with a two-segment lookup: `[projectId]/[filename]`. If the locked decision truly omits `projectId`, clarify in planning — a single `filename` segment would require a global unique filename constraint across all projects' assets, which the current schema does not enforce. This may just mean: the URL pattern is `/api/internal/assets/[projectId]/[filename]` but the route file is under a different path than the existing public one. Treat as LOW risk — planner should confirm.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all functionality uses Node.js built-ins and existing project code)

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.x |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test:run --reporter=verbose tests/unit/lib/mime-magic.test.ts tests/unit/lib/file-utils.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CACHE-01 | `ensureAssistantCacheDir()` creates `data/cache/assistant/` | unit | `pnpm test:run tests/unit/lib/file-utils.test.ts` | ✅ (extend existing) |
| CACHE-02 | `detectImageMime()` accepts JPEG/PNG/GIF/WEBP, rejects others | unit | `pnpm test:run tests/unit/lib/mime-magic.test.ts` | ❌ Wave 0 |
| CACHE-02 | Upload route rejects non-image via 400 | unit | `pnpm test:run tests/unit/api/assistant-images-route.test.ts` | ❌ Wave 0 |
| CACHE-03 | Upload route rejects `../` traversal filenames (UUID prevents) | unit | included in `assistant-images-route.test.ts` | ❌ Wave 0 |
| CACHE-04 | Cache GET route returns image bytes with correct Content-Type | unit | `pnpm test:run tests/unit/api/cache-route.test.ts` | ❌ Wave 0 |
| CACHE-04 | Cache GET route returns 404 for missing file | unit | included in `cache-route.test.ts` | ❌ Wave 0 |
| CACHE-05 | Assets GET route returns file bytes for valid asset | unit | `pnpm test:run tests/unit/api/assets-route.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run tests/unit/lib/mime-magic.test.ts tests/unit/lib/file-utils.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/lib/mime-magic.test.ts` — covers CACHE-02 magic-byte detection
- [ ] `tests/unit/api/assistant-images-route.test.ts` — covers CACHE-02 (invalid MIME rejection), CACHE-03 (path traversal protection)
- [ ] `tests/unit/api/cache-route.test.ts` — covers CACHE-04 (200 with bytes, 404 for missing)
- [ ] `tests/unit/api/assets-route.test.ts` — covers CACHE-05 (200 for valid asset)

---

## Sources

### Primary (HIGH confidence)

- Codebase: `src/lib/file-utils.ts` — `DATA_ROOT`, `assertWithinDataRoot`, `getCacheDir`, `ensureCacheDir` patterns
- Codebase: `src/lib/file-serve.ts` — `MIME_MAP`, `resolveAssetPath` pattern (used in production since v0.x)
- Codebase: `src/lib/internal-api-guard.ts` — `requireLocalhost` implementation and documentation
- Codebase: `src/actions/asset-actions.ts` — `uploadAsset()` — FormData handling, size check, containment check
- Codebase: `src/app/api/files/assets/[projectId]/[filename]/route.ts` — static file serving pattern
- Codebase: `src/app/api/internal/assistant/route.ts` — internal route conventions (`dynamic`, `runtime`, guard call)
- Codebase: `tests/unit/lib/file-utils.test.ts` — test pattern for `process.cwd()` mocking

### Secondary (MEDIUM confidence)

- WebP Container Specification: https://developers.google.com/speed/webp/docs/riff_container — bytes 8-11 WEBP FourCC requirement
- PNG spec section 12.12: 8-byte PNG signature starting with `89 50 4E 47`

### Tertiary (LOW confidence)

- None required — all claims verified from codebase or well-established format specs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are project-pinned, already in use
- Architecture: HIGH — patterns cloned from existing production code in the same repo
- Pitfalls: HIGH — verified against actual test patterns (`file-utils.test.ts`) and known Next.js App Router vs Pages Router differences
- Magic byte signatures: HIGH — JPEG/PNG/GIF are decades-stable; WEBP verified against official Google spec

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (stable domain — Next.js App Router file handling APIs do not change frequently)
