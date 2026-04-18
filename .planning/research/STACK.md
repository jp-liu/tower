# Technology Stack — v0.93 Chat Media Support

**Project:** Tower — Chat Image Paste (v0.93)
**Researched:** 2026-04-18
**Confidence:** HIGH — all claims based on direct inspection of installed type definitions and existing codebase. No guesswork.

---

## Summary: No New Dependencies Required

All required APIs are available in the current stack. This milestone requires zero new npm packages. The work is plumbing between existing browser APIs, existing cache infrastructure (`data/cache/`), and the Claude Agent SDK's `MessageParam` type already present in the installed `@anthropic-ai/sdk@0.81.0`.

---

## Browser APIs (No New Dependencies)

### Clipboard API — paste event interception

**Source:** MDN Web Docs (built-in browser API)
**Confidence:** HIGH

```typescript
// Attach to the <Textarea> element's onPaste handler
const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
  const items = Array.from(e.clipboardData.items);
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) void handleImageFile(file);
    }
  }
};
```

- `ClipboardEvent.clipboardData.items` — `DataTransferItemList`
- `DataTransferItem.type` — MIME string, e.g. `"image/png"`
- `DataTransferItem.getAsFile()` — returns `File | null`
- Works in all modern browsers; no polyfill needed

### File API — thumbnail preview

**Source:** Built-in browser API
**Confidence:** HIGH

```typescript
// Immediate local preview (no upload needed)
const previewUrl = URL.createObjectURL(file); // revoke after unmount/send

// Read bytes for upload
const buffer = await file.arrayBuffer();
```

`URL.createObjectURL` produces a `blob:` URL for `<img src>` previews without any server round-trip. Must call `URL.revokeObjectURL(url)` when the preview is removed or the message is sent.

### Accepted MIME types

Constrained to what Claude API accepts for image blocks:

| Extension | MIME Type | Claude Accepts |
|-----------|-----------|---------------|
| .png | image/png | YES |
| .jpg/.jpeg | image/jpeg | YES |
| .gif | image/gif | YES |
| .webp | image/webp | YES |

Reject other MIME types at paste time with a toast. Do not attempt to handle SVG (not accepted by Claude API image blocks).

---

## Server-Side: Image Cache Storage

### New utility functions in `src/lib/file-utils.ts`

The existing `ensureCacheDir(taskId)` is task-scoped. Add a shared image cache directory:

```typescript
// Add to src/lib/file-utils.ts:
export function getImageCacheDir(): string {
  const dir = path.join(DATA_ROOT, "cache", "images");
  assertWithinDataRoot(dir);
  return dir;
}

export function ensureImageCacheDir(): string {
  const dir = getImageCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```

Storage path: `data/cache/images/<uuid>.<ext>`

File naming: `crypto.randomUUID()` + extension derived from MIME type. No DB record — these are ephemeral assistant-session artifacts.

### New API route: `POST /api/internal/assistant/upload-image`

Accepts `multipart/form-data` with a `file` field. Returns `{ filename, mimeType }`.

```
src/app/api/internal/assistant/upload-image/route.ts
```

Security requirements (follow existing internal route conventions):
- Call `requireLocalhost(request)` from `src/lib/internal-api-guard.ts`
- Enforce max file size (5 MB per image) — read from `getConfigValue("system.maxUploadBytes", 5242880)`
- Validate MIME type against allowlist before writing
- Containment check: `path.resolve(dest).startsWith(cacheDir + path.sep)`
- Sanitize filename: use UUID, not the original filename, to eliminate path traversal

### New API route: `GET /api/files/cache/images/[filename]`

Serves cached images to the browser (for the preview strip thumbnail).

```
src/app/api/files/cache/images/[filename]/route.ts
```

Pattern: mirrors `src/app/api/files/assets/[projectId]/[filename]/route.ts`. Read file, return with correct `Content-Type` from `MIME_MAP` in `src/lib/file-serve.ts`. Containment check required.

---

## Claude Agent SDK — Image Parameter Format

**Source:** Directly read from installed type definitions at:
- `node_modules/.pnpm/@anthropic-ai+sdk@0.81.0_zod@4.3.6/node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts`
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`

**Confidence:** HIGH

### Type hierarchy

```typescript
// From @anthropic-ai/sdk@0.81.0
interface MessageParam {
  content: string | Array<ContentBlockParam>;
  role: "user" | "assistant";
}

interface ImageBlockParam {
  type: "image";
  source: Base64ImageSource | URLImageSource;
  cache_control?: CacheControlEphemeral | null;
}

interface Base64ImageSource {
  type: "base64";
  data: string;                 // base64 string, NO "data:..." prefix
  media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

interface URLImageSource {
  type: "url";
  url: string;
}
```

### Use Base64, not URL

`URLImageSource` is also valid, but requires the Claude subprocess to fetch the URL. Since Tower is localhost-only and the Claude subprocess may run in a sandboxed network context, fetching `http://localhost:3000/api/files/...` from within the subprocess is unreliable. **Use `Base64ImageSource` exclusively.**

### How to pass images to `query()`

Current `chat/route.ts` passes `prompt` as a plain string. When images are present, switch to `AsyncIterable<SDKUserMessage>`:

```typescript
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources";

// Build multi-block content
const content: MessageParam["content"] = [
  { type: "text", text: `/tower ${body.message}` },
  ...imageBlocks, // ImageBlockParam[]
];

const sdkMessage: SDKUserMessage = {
  type: "user",
  parent_tool_use_id: null,
  message: { role: "user", content },
};

async function* promptStream(): AsyncGenerator<SDKUserMessage> {
  yield sdkMessage;
}

const q = query({
  prompt: promptStream(),
  options: options as Parameters<typeof query>[0]["options"],
});
```

When no images are attached, keep the existing `prompt: \`/tower ${body.message}\`` string path unchanged.

### Building `imageBlocks` on the server

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getImageCacheDir } from "@/lib/file-utils";

interface ImageRef {
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

async function buildImageBlocks(images: ImageRef[]) {
  const cacheDir = getImageCacheDir();
  return Promise.all(
    images.map(async ({ filename, mimeType }) => {
      // Containment check
      const resolved = path.resolve(cacheDir, filename);
      if (!resolved.startsWith(cacheDir + path.sep)) throw new Error("Invalid image ref");
      const buf = await fs.readFile(resolved);
      return {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mimeType,
          data: buf.toString("base64"),
        },
      };
    })
  );
}
```

---

## API Contract Changes

### `POST /api/internal/assistant/chat` — extended body

Current: `{ message: string, sessionId?: string }`
New: `{ message: string, sessionId?: string, images?: ImageRef[] }`

```typescript
interface ImageRef {
  filename: string;  // UUID-named file in data/cache/images/
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}
```

Keeping filenames in the body (rather than base64) keeps the request body small. Server reads files from disk when building the SDK message.

### Upload flow

```
User pastes image in browser
  → onPaste: extract File from ClipboardData
  → URL.createObjectURL(file) → local previewUrl for thumbnail
  → POST /api/internal/assistant/upload-image (FormData with file)
  → server writes data/cache/images/<uuid>.png
  → returns { filename: "abc.png", mimeType: "image/png" }
  → browser stores PendingImage { filename, mimeType, previewUrl }

User clicks Send
  → POST /api/internal/assistant/chat { message, images: [{ filename, mimeType }] }
  → server reads files, base64 encodes, builds AsyncIterable<SDKUserMessage>
  → query() streams normally
  → browser clears pendingImages, revokes previewUrls
```

---

## React Component Changes (No New Libraries)

### State shape for pending images

```typescript
interface PendingImage {
  filename: string;   // returned from upload API
  mimeType: string;
  previewUrl: string; // blob: URL from createObjectURL
}
```

### `AssistantChat` component

- Add `onPaste` to `<Textarea>` element
- Add horizontal-scrolling preview strip above the textarea when `pendingImages.length > 0`
- Each preview: small `<img>` (thumbnail) + X button to remove
- On remove: `URL.revokeObjectURL(previewUrl)`
- On send: pass `images` to `sendMessage`, then revoke all preview URLs and clear state

No new UI libraries needed. Plain `<img>` tags + existing `Button` + Tailwind.

### `useAssistantChat` hook

- `sendMessage(text: string)` → `sendMessage(text: string, images?: ImageRef[])`
- Pass `images` in the JSON body to the chat API
- No other structural changes

---

## Constraints

- Max 5 images per message (enforce in UI before upload)
- Max 5 MB per image (enforce on server, aligned with `system.maxUploadBytes`)
- Only `image/jpeg`, `image/png`, `image/gif`, `image/webp` (Claude API hard limit)
- No auto-cleanup of `data/cache/images/` — out of scope per PROJECT.md

---

## Integration Points with Existing Code

| File | Change |
|------|--------|
| `src/lib/file-utils.ts` | Add `getImageCacheDir()` + `ensureImageCacheDir()` |
| `src/hooks/use-assistant-chat.ts` | Extend `sendMessage` to accept optional `images?: ImageRef[]` |
| `src/components/assistant/assistant-chat.tsx` | Add paste handler + image preview strip |
| `src/app/api/internal/assistant/chat/route.ts` | Accept `images?` in body; build `AsyncIterable<SDKUserMessage>` when images present |
| `src/app/api/internal/assistant/upload-image/route.ts` | **New** — upload handler |
| `src/app/api/files/cache/images/[filename]/route.ts` | **New** — serve cached images |

---

## Alternatives Considered

| Approach | Why Not |
|----------|---------|
| Send base64 directly in chat body | Bloats the POST body (up to 20 MB for 5 images); file-first decouples upload latency |
| `URLImageSource` | Claude subprocess may be network-sandboxed; localhost fetch unreliable |
| Store images in DB as blobs | Unnecessary; ephemeral on-disk cache consistent with existing `data/cache/` pattern |
| `react-dropzone` / paste library | Native `ClipboardEvent` on `<textarea>` covers 100% of the use case |
| `sharp` for server-side resizing | Native dependency; Claude handles large images; skip for now |
| Inline images in SSE stream (data URLs) | Inflates streamed response size; separate serve route is cleaner |

---

## Sources

- `@anthropic-ai/sdk@0.81.0` type definitions (read from disk): `node_modules/.pnpm/@anthropic-ai+sdk@0.81.0_zod@4.3.6/.../resources/messages/messages.d.ts` — **HIGH**
- `@anthropic-ai/claude-agent-sdk@0.2.114` type definitions (read from disk): `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — **HIGH**
- Existing codebase: `src/lib/file-utils.ts`, `src/actions/asset-actions.ts`, `src/app/api/internal/assistant/chat/route.ts`, `src/lib/file-serve.ts` — **HIGH**
- MDN Clipboard API: https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData — **HIGH**
- MDN File API / FileReader: https://developer.mozilla.org/en-US/docs/Web/API/FileReader — **HIGH**
- MDN URL.createObjectURL: https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL — **HIGH**
