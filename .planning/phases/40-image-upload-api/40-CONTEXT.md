# Phase 40: Image Upload API - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** Auto-generated (--auto flag, recommendations auto-accepted)

<domain>
## Phase Boundary

A secure server-side endpoint accepts image uploads from paste events, stores them in the assistant cache directory, and serves them via short paths. This phase delivers the upload API, MIME validation, path traversal protection, and static file serving for both cached images and project assets.

</domain>

<decisions>
## Implementation Decisions

### Upload API Design
- POST endpoint at `/api/internal/assistant/images` using Next.js App Router route handler
- Accept `multipart/form-data` with a single `file` field (consistent with existing `uploadAsset` pattern in `asset-actions.ts`)
- Return `{ filename, mimeType }` on success — filename is the UUID-based name, not the original
- Apply `requireLocalhost()` guard (per security rules for all `/api/internal/` routes)

### File Storage
- Store in `data/cache/assistant/<uuid>.<ext>` — new subdirectory under existing `data/cache/`
- Use `crypto.randomUUID()` for filename generation (Node.js built-in, no extra dependency)
- Extension derived from validated MIME type (not from original filename) — e.g., `image/png` → `.png`
- Add `ensureAssistantCacheDir()` and `getAssistantCacheDir()` helpers to `file-utils.ts`

### MIME Validation
- Validate via magic bytes (file signature), not `Content-Type` header or file extension
- Allowed types: `image/jpeg`, `image/png`, `image/gif`, `image/webp` (per CACHE-02)
- Read first 12 bytes to check known signatures (JPEG `FF D8 FF`, PNG `89 50 4E 47`, GIF `47 49 46`, WEBP `52 49 46 46...57 45 42 50`)
- Reject with 400 `{ error: "Unsupported file type" }` if magic bytes don't match

### Path Traversal Protection
- Use `path.resolve()` + containment check against `data/cache/assistant/` (same pattern as `assertWithinDataRoot` in `file-utils.ts`)
- UUID-generated filenames inherently prevent traversal — original filename is never used in storage path
- Double-check: resolved path must start with the assistant cache directory

### Static File Serving
- Serve cached images via `/api/internal/cache/[filename]/route.ts` GET handler
- Serve project assets via `/api/internal/assets/[filename]/route.ts` GET handler
- Both routes: `requireLocalhost()`, validate filename format, read from filesystem, return with correct `Content-Type`
- Set `Cache-Control: private, max-age=3600` for browser caching
- Return 404 for missing files

### Claude's Discretion
- Max upload size: use existing `system.maxUploadBytes` config (default 50MB) — images are typically small, but reuse existing pattern
- Error response format: `{ error: string }` consistent with other internal API routes

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/file-utils.ts` — `DATA_ROOT`, `assertWithinDataRoot()`, `ensureCacheDir()`, `ensureAssetsDir()` patterns to follow
- `src/lib/internal-api-guard.ts` — `requireLocalhost()`, `validateTaskId()` for security
- `src/actions/asset-actions.ts` — `uploadAsset()` has FormData handling, path traversal protection, filename sanitization patterns
- `src/app/api/internal/assistant/route.ts` — existing assistant API route pattern (`dynamic`, `runtime` exports, `requireLocalhost()`)

### Established Patterns
- Internal API routes use `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"`
- Error responses use `NextResponse.json({ error: message }, { status: code })`
- File storage uses `data/` root directory with subdirectories per domain
- Security: `requireLocalhost()` is mandatory for all `/api/internal/` routes

### Integration Points
- `data/cache/assistant/` — new directory, sits alongside existing `data/cache/` task cache
- Phase 41 will call this upload API from the frontend paste handler
- Phase 42 will use the static serving routes to display images in message bubbles

</code_context>

<specifics>
## Specific Ideas

- MIME type map for extension derivation: `{ "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp" }`
- Magic bytes checking should be a standalone utility function for reuse in future file type extensions (AI-03)

</specifics>

<deferred>
## Deferred Ideas

- Non-image file support (FILE-01) — future milestone
- Drag-and-drop upload (FILE-02) — future milestone
- Auto cache cleanup (FILE-03) — explicitly out of scope per REQUIREMENTS.md

</deferred>
