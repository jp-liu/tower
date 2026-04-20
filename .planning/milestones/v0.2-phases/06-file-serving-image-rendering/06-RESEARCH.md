# Phase 6: File Serving & Image Rendering — Research

**Researched:** 2026-03-27
**Domain:** Next.js Route Handlers (binary file serving) + React Markdown image components
**Confidence:** HIGH

---

## Summary

Phase 6 has two independent sub-problems:

**Sub-problem 1 (ASST-04):** Expose files stored under `data/assets/{projectId}/` via an HTTP GET route at `/api/files/assets/{projectId}/{filename}`. The critical requirement is path-traversal prevention: `projectId` and `filename` must both be validated by resolving the final path and confirming it stays within `DATA_ROOT`. Content-Type is determined by file extension using a static MIME map. The response body is the raw file bytes (Node `fs.promises.readFile` → `Uint8Array` → `new Response(bytes, { headers })`).

**Sub-problem 2 (UI-03):** Task messages already render via `react-markdown` with a `components` prop API. Images in markdown (`![alt](src)`) invoke the `img` component renderer. Override `img` to detect local asset paths (e.g., paths starting with `/api/files/`) and render a styled `<img>` tag. For paths that aren't HTTP URLs (e.g., raw `data/assets/...` file paths stored by MCP tools), transform them to the API URL before rendering.

Both sub-problems are small and self-contained. One plan covering both is sufficient.

**Primary recommendation:** One plan — Route Handler for file serving + `img` component override in `task-conversation.tsx`.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ASST-04 | Next.js API Route securely provides file access (prevent path traversal) | Route Handler pattern with `path.resolve` guard; verified against existing execute/stream route patterns in this codebase |
| UI-03 | Task conversation images render inline when image paths are in messages | `react-markdown` `components.img` override; already used in task-conversation.tsx with ReactMarkdown + remarkGfm |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` (Route Handler) | 16.2.1 (installed) | HTTP GET endpoint for file serving | Already in project; App Router Route Handlers are the correct pattern for binary responses |
| `react-markdown` | ^10.1.0 (installed) | Markdown rendering with component overrides | Already used in `task-conversation.tsx`; `components.img` is the correct extension point |
| `node:fs/promises` | Node built-in | Async file reading for route handler | No extra dependency; `readFile` returns `Buffer` → cast to `Uint8Array` for Web `Response` |
| `node:path` | Node built-in | Path resolution + traversal guard | `path.resolve` is the standard traversal-prevention technique |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `next/server` → `NextRequest` | 16.2.1 | Typed request in Route Handler | Route Handler receives `NextRequest`; `params` is `Promise<{...}>` in this Next.js version |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled MIME map | `mime-types` npm package | The project serves a bounded set of asset types; a 10-entry static map avoids a new dependency |
| `fs.readFileSync` | `fs.promises.readFile` | Async keeps the Next.js worker thread unblocked for large files |

**Installation:** No new packages needed. All libraries are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/app/api/files/assets/[projectId]/[filename]/
└── route.ts          # GET handler for file serving

src/components/task/
└── task-conversation.tsx    # Add img component override to existing ReactMarkdown usage
```

### Pattern 1: Next.js Route Handler for Binary File Serving

**What:** A `GET` route handler reads a file from disk and returns it as a binary `Response` with a `Content-Type` header derived from the file extension.

**When to use:** Any time Next.js must serve local disk files over HTTP.

**Key constraint from AGENTS.md:** `params` is `Promise<{ projectId: string; filename: string }>` in Next.js 16 — must `await params` before destructuring.

**Example:**
```typescript
// src/app/api/files/assets/[projectId]/[filename]/route.ts
// Source: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
import { NextRequest } from "next/server";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const DATA_ROOT = path.join(process.cwd(), "data");

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; filename: string }> }
) {
  const { projectId, filename } = await params;

  // Path traversal guard
  const resolved = path.resolve(DATA_ROOT, "assets", projectId, filename);
  if (!resolved.startsWith(path.resolve(DATA_ROOT) + path.sep)) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(resolved);
  } catch {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}
```

### Pattern 2: react-markdown `img` Component Override

**What:** Pass a custom `img` renderer to `ReactMarkdown` via the `components` prop. The renderer transforms raw file system paths (e.g., `data/assets/proj123/image.png`) to API URLs before rendering.

**When to use:** Any time image sources in markdown content may be local file paths rather than HTTP URLs.

**Example:**
```typescript
// In task-conversation.tsx — extend the existing ReactMarkdown usage
// Source: node_modules/react-markdown/readme.md — Appendix B: Components

function localPathToApiUrl(src: string): string {
  // Match data/assets/{projectId}/{filename} or /data/assets/{projectId}/{filename}
  const match = src.match(/(?:^|\/)data\/assets\/([^/]+)\/([^/]+)$/);
  if (match) {
    return `/api/files/assets/${match[1]}/${match[2]}`;
  }
  return src; // already an HTTP URL or unrecognized — pass through
}

// Inside ReactMarkdown:
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    img({ src, alt }) {
      const resolvedSrc = src ? localPathToApiUrl(src) : "";
      return (
        <img
          src={resolvedSrc}
          alt={alt ?? ""}
          className="max-w-full rounded-md my-2"
        />
      );
    },
  }}
>
  {message.content}
</ReactMarkdown>
```

### Anti-Patterns to Avoid

- **Direct string contains / startsWith for path traversal checks:** `filename.includes('..')` is NOT sufficient. URL-encoded sequences, null bytes, and multi-segment paths can bypass string checks. Always use `path.resolve` and compare the resolved path against `DATA_ROOT`.
- **Synchronous `fs.readFileSync` in a Route Handler:** Blocks the Node.js event loop. Use `fs.promises.readFile`.
- **Setting `Content-Disposition: attachment` on image types:** The browser will download instead of display inline. Omit `Content-Disposition` for images.
- **Using `NextResponse.json` for binary responses:** `NextResponse.json` sets `Content-Type: application/json`. For binary, construct `new Response(bytes, { headers })` directly.
- **`dangerouslySetInnerHTML` for image rendering:** `react-markdown`'s `components` prop is safe — no XSS surface.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown image rendering | Custom markdown parser | `react-markdown` `components.img` override | Already installed; handles all CommonMark edge cases |
| MIME type detection | Complex sniffing logic | Static extension→MIME map | Asset types are bounded; full MIME library is overkill |
| Path safety | Regex-based path sanitization | `path.resolve` + `startsWith(DATA_ROOT)` | Handles URL encoding, `..`, symlinks; regex cannot |

**Key insight:** Both problems have exact solutions already present in the installed stack — no new dependencies needed.

---

## Common Pitfalls

### Pitfall 1: `params` Must Be Awaited

**What goes wrong:** Destructuring `params` without awaiting throws a runtime error in Next.js 16 App Router.

**Why it happens:** Next.js 16 changed `params` from a plain object to a `Promise` (breaking change from Next.js 13/14 behavior).

**How to avoid:** Always `const { projectId, filename } = await params;`

**Warning signs:** Runtime error: "params should be awaited before using its properties".

---

### Pitfall 2: Path Traversal via Encoded Characters

**What goes wrong:** A filename like `%2F..%2F..%2Fetc%2Fpasswd` bypasses string-level `..` checks.

**Why it happens:** URL decoding happens before the handler receives `filename` from `params`. The decoded string can contain `/`.

**How to avoid:** Use `path.resolve(DATA_ROOT, "assets", projectId, filename)` and check `resolved.startsWith(path.resolve(DATA_ROOT) + path.sep)`. `path.resolve` normalizes all separators and traversal sequences AFTER decoding.

**Warning signs:** Test with `projectId = "../../etc"` and `filename = "passwd"` — must return 400.

---

### Pitfall 3: DATA_ROOT Differs Between Process.cwd() Contexts

**What goes wrong:** `process.cwd()` in a Next.js Route Handler returns the project root (same as in Next.js server actions), so `data/assets/` is the right base. But unit tests that mock `process.cwd()` must do so before the module is imported (same constraint as in `file-utils.ts`).

**Why it happens:** `DATA_ROOT` is evaluated at module load time, not at request time.

**How to avoid:** In unit tests, use `vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)` before importing the route module — exactly the pattern established in `tests/unit/lib/file-utils.test.ts`.

**Warning signs:** Tests pass but production points to wrong directory; or tests fail when run in different order.

---

### Pitfall 4: `img` `src` Is Undefined in react-markdown

**What goes wrong:** The `img` component renderer receives `src` as `string | undefined`. Passing `undefined` to an `<img src>` renders a broken image.

**Why it happens:** `react-markdown` passes all HTML attribute values as optional.

**How to avoid:** Guard: `const resolvedSrc = src ? localPathToApiUrl(src) : "";`

---

## Code Examples

### Path Traversal Guard (verified)
```typescript
// Source: Node.js path module — verified via local node execution
const resolved = path.resolve(DATA_ROOT, "assets", projectId, filename);
if (!resolved.startsWith(path.resolve(DATA_ROOT) + path.sep)) {
  return new Response(JSON.stringify({ error: "Invalid path" }), { status: 400 });
}
// Tested: path.resolve('/app/data', 'assets', '../../etc', 'passwd') → '/app/etc/passwd'
// → does NOT start with '/app/data/' → returns 400. Correct.
```

### Binary Response from Node Buffer
```typescript
// Source: MDN Web API — Buffer is a Uint8Array subclass; Response accepts Uint8Array
const bytes = await fs.readFile(resolved);  // Buffer
return new Response(bytes, {
  status: 200,
  headers: { "Content-Type": contentType },
});
```

### Existing Route Handler Signature Pattern (from this codebase)
```typescript
// Source: src/app/api/tasks/[taskId]/execute/route.ts (verified in codebase)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  // ...
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `params` as plain object | `params` as `Promise<{...}>` | Next.js 15+ (this project uses 16) | Must `await params` in every Route Handler |
| `NextResponse.json` for all responses | `new Response(body, { headers })` for binary | Always correct, but more explicit now | Binary files need raw `Response`, not `NextResponse` |

---

## Environment Availability

Step 2.6: SKIPPED — Phase 6 is code-only changes with no external service dependencies. All required tools (`node:fs`, `node:path`, React, next) are already available in the project.

---

## Validation Architecture

`nyquist_validation` key is absent from `.planning/config.json` — treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test:run --reporter=verbose` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ASST-04 | GET /api/files/assets/{id}/{file} returns bytes + correct Content-Type | unit | `pnpm test:run tests/unit/api/file-serving.test.ts` | No — Wave 0 |
| ASST-04 | Path traversal `../../etc/passwd` returns 400 | unit | same file | No — Wave 0 |
| ASST-04 | Missing file returns 404 | unit | same file | No — Wave 0 |
| UI-03 | `localPathToApiUrl` maps data/ paths to /api/files/ URLs | unit | `pnpm test:run tests/unit/lib/local-path-to-api-url.test.ts` | No — Wave 0 |
| UI-03 | `localPathToApiUrl` passes through HTTP URLs unchanged | unit | same file | No — Wave 0 |

> Note: Route Handler unit testing in vitest requires extracting the handler logic (path resolution, MIME map, traversal guard) into a pure helper function so tests can import and call it directly without standing up a Next.js server. This is the established pattern in this codebase (see `file-utils.ts` — pure functions, no framework imports).

### Sampling Rate
- **Per task commit:** `pnpm test:run` (full suite — fast, ~330ms historically)
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/api/file-serving.test.ts` — covers ASST-04 (traversal guard, Content-Type, 404)
- [ ] `tests/unit/lib/local-path-to-api-url.test.ts` — covers UI-03 path transformation logic

*(Existing test infrastructure covers the rest — no new framework config or fixtures needed)*

---

## Open Questions

1. **What image path format do MCP tools store in TaskMessage.content?**
   - What we know: `manage_assets` stores assets at `data/assets/{projectId}/{filename}`. Messages are stored as plain text content via `sendTaskMessage` in `agent-actions.ts`.
   - What's unclear: When an AI agent references an asset in a message, does it use the absolute disk path, the relative path from `process.cwd()`, or the API URL? This determines the exact regex in `localPathToApiUrl`.
   - Recommendation: The regex should match both `data/assets/{id}/{file}` (relative) and `/data/assets/{id}/{file}` (absolute-relative) to be resilient. The planner should note this in the implementation task.

2. **Does Next.js 16 Route Handler streaming differ for large files?**
   - What we know: `fs.promises.readFile` loads the whole file into memory. For the asset types stored (images, PDFs), this is acceptable.
   - What's unclear: Maximum asset file size is undefined.
   - Recommendation: Use `readFile` for now (simple). If streaming becomes necessary, use `fs.createReadStream` wrapped in a `ReadableStream` — defer to future phase.

---

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` — Route Handler conventions, caching, params
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` — Dynamic params, context, examples
- `node_modules/react-markdown/readme.md` — components prop, `img` element, Appendix B
- `src/app/api/tasks/[taskId]/execute/route.ts` — verified `params: Promise<{...}>` pattern in this exact codebase
- `src/components/task/task-conversation.tsx` — verified existing ReactMarkdown usage, extension point confirmed
- `src/lib/file-utils.ts` — verified `DATA_ROOT` definition and path helpers
- Node.js local execution — path traversal guard logic verified with actual `path.resolve` calls

### Secondary (MEDIUM confidence)
- `package.json` — confirmed next@16.2.1, react-markdown@^10.1.0, no mime-types dependency
- `vitest.config.ts` — confirmed test environment and include patterns

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed; patterns verified against live codebase files
- Architecture: HIGH — Route Handler pattern verified against existing routes in this codebase; react-markdown components API verified from installed package readme
- Pitfalls: HIGH — path traversal guard verified with actual Node.js execution; params await requirement confirmed from existing route handlers

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable stack — Next.js + react-markdown are pinned in package.json)
