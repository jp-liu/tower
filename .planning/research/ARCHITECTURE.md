# Architecture: Chat Image Paste Integration (v0.93)

**Domain:** Multimodal input for existing SSE-based assistant chat
**Researched:** 2026-04-18
**Confidence:** HIGH — all findings from direct source inspection + SDK type verification

---

## Existing Chat Architecture (v0.92 baseline)

The assistant chat is a three-layer stack:

```
Browser (AssistantChat.tsx)
  └── AssistantProvider (React context — chat state persists across routes)
        └── sendChatMessage(text: string)
              └── POST /api/internal/assistant/chat
                    └── Claude Agent SDK: query({ prompt: `/tower ${text}`, options })
                          └── SSE stream → browser
```

### Key Contracts That Must Be Preserved

1. `sendChatMessage(text: string)` — provider API consumed by AssistantChat
2. `POST /api/internal/assistant/chat` — body `{ message: string, sessionId?: string }`
3. SSE event types: `text`, `text_delta`, `tool_use`, `tool_start`, `tool_result`, `error`, `done`
4. `query()` prompt type: `string | AsyncIterable<SDKUserMessage>`

---

## Data Flow: paste → cache → preview → send → SDK

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. PASTE EVENT (browser)                                         │
│    onPaste handler in AssistantChat.tsx                          │
│    ClipboardEvent.clipboardData.items                            │
│    → filter item.kind === "file" && item.type.startsWith("image")│
│    → item.getAsFile() → File object                              │
└────────────────────────┬─────────────────────────────────────────┘
                         │ File (in-memory)
┌────────────────────────▼─────────────────────────────────────────┐
│ 2. UPLOAD TO CACHE (browser → server)                            │
│    POST /api/internal/assistant/images                           │
│    Body: FormData { file: File }                                 │
│    → Route handler writes to data/cache/assistant/uuid.ext       │
│    → Returns { id: uuid, url: "/api/serve/cache/uuid.ext",       │
│                filename: "uuid.ext", size: N }                   │
│    (uses existing getCacheDir + ensureCacheDir from file-utils)  │
└────────────────────────┬─────────────────────────────────────────┘
                         │ { id, url, filename }
┌────────────────────────▼─────────────────────────────────────────┐
│ 3. PREVIEW (browser — local state)                               │
│    pendingImages: PendingImage[]                                 │
│    Each: { id, url, filename, localPreview: ObjectURL }          │
│    Rendered as thumbnail strip above the Textarea                │
│    × button removes from pendingImages                           │
└────────────────────────┬─────────────────────────────────────────┘
                         │ pendingImages passed to send
┌────────────────────────▼─────────────────────────────────────────┐
│ 4. SEND (browser → server)                                       │
│    POST /api/internal/assistant/chat                             │
│    Body: { message: string, sessionId?: string,                  │
│            images?: string[] }   ← NEW: absolute file paths      │
│    (URL paths resolved server-side to absolute paths)            │
└────────────────────────┬─────────────────────────────────────────┘
                         │ images as absolute paths
┌────────────────────────▼─────────────────────────────────────────┐
│ 5. SDK CALL (server — /api/internal/assistant/chat route)        │
│    If images present:                                            │
│      Read each file → Buffer → base64                            │
│      Build SDKUserMessage with MessageParam.content as array:    │
│        [{ type: "text", text: "/tower <message>" },              │
│         { type: "image", source: { type: "base64",               │
│           media_type: "image/jpeg", data: "..." } }, ...]        │
│      query({ prompt: asyncIterableOfOneSDKUserMessage, options })│
│    Else (no images — current behavior):                          │
│      query({ prompt: `/tower ${message}`, options })             │
└──────────────────────────────────────────────────────────────────┘
```

---

## New Components

### 1. `POST /api/internal/assistant/images` (new route)

Location: `src/app/api/internal/assistant/images/route.ts`

Purpose: Accept FormData upload, write to cache, return metadata.

```
Input:  FormData { file: File }
Output: { id: string, path: string, filename: string, size: number }
Security:
  - requireLocalhost(request) — same as all internal routes
  - path.basename(file.name) sanitization — same as uploadAsset()
  - Contain within getCacheDir("assistant") via assertWithinDataRoot
  - Max size: read from getConfigValue("system.maxUploadBytes", 52428800)
Storage: data/cache/assistant/<uuid>.<ext>
```

The route does NOT create a DB record. Cache images are ephemeral — no ProjectAsset row needed for the assistant use case.

### 2. `ImagePasteBar` component (new component)

Location: `src/components/assistant/image-paste-bar.tsx`

Purpose: Render the thumbnail strip with delete affordance.

```tsx
interface PendingImage {
  id: string;          // uuid returned by upload API
  filename: string;    // uuid.ext
  localPreview: string; // object URL for <img src>
  absolutePath: string; // server-side absolute path for SDK
}

interface ImagePasteBarProps {
  images: PendingImage[];
  onRemove: (id: string) => void;
}
```

Renders a horizontal flex strip. Each thumbnail is a 48x48px `<img>` with an overlay `×` button. Strip only mounts when `images.length > 0` (no layout shift on empty state).

---

## Modified Components

### 3. `AssistantChat.tsx` — modified

The chat input section gains paste handling and preview strip:

```
New state:
  pendingImages: PendingImage[] (local to AssistantChat)
  isUploading: boolean (debounce send during upload)

New paste handler:
  onPaste → extract image files → upload each via fetch → add to pendingImages
  createObjectURL for local preview (revoke on remove)

handleSend modification:
  pass { images: pendingImages.map(i => i.absolutePath) } alongside text
  clear pendingImages after send

Layout change:
  <ImagePasteBar /> inserted between ScrollArea and border-t input area
```

### 4. `AssistantProvider.tsx` — modified

`sendChatMessage` signature change: `(text: string, images?: string[]) => void`

Modification to the fetch call body:

```typescript
body: JSON.stringify({
  message: text,
  sessionId: sessionIdRef.current,
  ...(images && images.length > 0 ? { images } : {}),
})
```

No other changes to provider. SSE parsing loop untouched — the server sends the same event types.

### 5. `/api/internal/assistant/chat/route.ts` — modified

Body parsing adds optional `images` field:

```typescript
body: { message: string; sessionId?: string; images?: string[] }
```

SDK call branches:

```typescript
if (body.images && body.images.length > 0) {
  // Build multimodal SDKUserMessage
  const imageBlocks = await Promise.all(
    body.images.map(async (absPath) => {
      // Validate path stays within data/cache/assistant/
      const data = await fs.readFile(absPath);
      const ext = path.extname(absPath).slice(1).toLowerCase();
      const mediaType = ext === "png" ? "image/png"
        : ext === "gif" ? "image/gif"
        : ext === "webp" ? "image/webp"
        : "image/jpeg";
      return {
        type: "image" as const,
        source: { type: "base64" as const, media_type: mediaType, data: data.toString("base64") }
      };
    })
  );

  const userMessage: SDKUserMessage = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }, ...imageBlocks]
    },
    parent_tool_use_id: null,
  };

  const q = query({
    prompt: (async function* () { yield userMessage; })(),
    options: options as Parameters<typeof query>[0]["options"],
  });
  // ... same for-await loop
} else {
  // existing path — unchanged
  const q = query({ prompt, options });
}
```

Path validation: before `fs.readFile`, resolve and assert the path starts with `path.join(process.cwd(), "data/cache/assistant/")`. Prevents path traversal if `images` array is tampered.

---

## File Serving for Thumbnails

Browser-side previews use `createObjectURL(file)` — no server round-trip needed for the thumbnail display. The `localPreview` ObjectURL is revoked when the image is removed or after send (call `URL.revokeObjectURL`).

The `/api/serve/cache/...` route mentioned in PROJECT.md (file serving for assets) may already exist. Verify before adding a new route. If the cache directory is not yet served, add a minimal GET handler at `/api/internal/assistant/images/[filename]/route.ts` for serving uploaded images if needed by external consumers — but for the thumbnail strip itself, ObjectURLs are sufficient and preferred (no server roundtrip).

---

## Cache Directory Layout

```
data/
  cache/
    assistant/         ← NEW: flat directory for chat image cache
      <uuid>.jpg
      <uuid>.png
      <uuid>.webp
    <taskId>/          ← EXISTING: per-task cache directories
      ...
```

The `assistant` subdirectory uses a fixed key instead of a taskId because chat sessions are not task-bound. `getCacheDir("assistant")` reuses the existing helper — "assistant" is just the directory name string.

---

## Component Boundary Summary

| Component | Status | Description |
|-----------|--------|-------------|
| `src/app/api/internal/assistant/images/route.ts` | **NEW** | Upload image to cache, return metadata |
| `src/components/assistant/image-paste-bar.tsx` | **NEW** | Thumbnail strip with delete affordance |
| `src/components/assistant/assistant-chat.tsx` | **MODIFIED** | Add onPaste, pendingImages state, ImagePasteBar |
| `src/components/assistant/assistant-provider.tsx` | **MODIFIED** | sendChatMessage gains optional images param |
| `src/app/api/internal/assistant/chat/route.ts` | **MODIFIED** | Parse images[], build SDKUserMessage for multimodal |
| `src/lib/file-utils.ts` | **UNCHANGED** | getCacheDir/ensureCacheDir already support arbitrary keys |

---

## Build Order (dependency chain)

```
Phase 1: New upload API route
  → Standalone — no dependencies on other new code
  → Establishes the cache directory and upload contract

Phase 2: ImagePasteBar component
  → Pure display — no API dependency yet (uses ObjectURLs)
  → Can be built with mock data

Phase 3: Paste handling in AssistantChat
  → Depends on Phase 1 (upload API) + Phase 2 (bar component)
  → Wire onPaste → upload → pendingImages → render bar
  → Verify thumbnail display end-to-end before touching SDK layer

Phase 4: Provider + API route: multimodal SDK call
  → Depends on Phase 1 (file paths must be valid on disk)
  → Modify sendChatMessage signature
  → Modify chat route to read files and build SDKUserMessage
  → Test with single image first
```

Phases 1-3 are independently testable without touching the SDK call. Phase 4 is the only risky change (SDK API contract). This ordering lets the UI be validated before the backend multimodal wiring is touched.

---

## SDK Multimodal Contract

The Claude Agent SDK `query()` accepts `prompt: string | AsyncIterable<SDKUserMessage>`. For multimodal input, use the `AsyncIterable<SDKUserMessage>` path. `SDKUserMessage.message` is a `MessageParam` from `@anthropic-ai/sdk/resources`, which supports the standard Anthropic content block format.

Image blocks use base64 encoding with explicit `media_type`. Supported media types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`. File size constraint: Claude API limits individual image size — read image to buffer and check size before encoding; emit an error SSE event if over limit rather than letting the SDK throw.

The session resume path (`options.resume = sessionId`) is compatible with multimodal — sessions store the full message history including image references. No session-management changes needed.

---

## Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Upload to server cache before send | Keeps browser side stateless; absolutePath on server avoids base64 re-encoding in browser |
| ObjectURL for thumbnail preview | Zero server roundtrip; revoked after use — no memory leak |
| Flat `data/cache/assistant/` directory | Reuses getCacheDir("assistant") — no new helpers needed |
| AsyncIterable path only when images present | Existing string prompt path is faster and tested; multimodal path is additive |
| Path validation before fs.readFile in route | Defense-in-depth: images array comes from HTTP body which could be tampered |
| images as absolute server paths in request body | Avoids double-upload (file already on server); route handler does the fs.readFile |
| PendingImage state local to AssistantChat | Provider doesn't need to know about pending images — only sent images matter |
| No DB record for cache images | Chat images are ephemeral; ProjectAsset is for persistent project assets only |

---

## Sources

All findings from direct source inspection (confidence HIGH):

- `/Users/liujunping/project/i/ai-manager/src/app/api/internal/assistant/chat/route.ts`
- `/Users/liujunping/project/i/ai-manager/src/components/assistant/assistant-provider.tsx`
- `/Users/liujunping/project/i/ai-manager/src/components/assistant/assistant-chat.tsx`
- `/Users/liujunping/project/i/ai-manager/src/lib/file-utils.ts`
- `/Users/liujunping/project/i/ai-manager/src/actions/asset-actions.ts`
- `/Users/liujunping/project/i/ai-manager/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — SDKUserMessage type
- Claude Agent SDK docs: https://code.claude.com/docs/en/agent-sdk/overview (SDKUserMessage + AsyncIterable prompt mode verified)
- `/Users/liujunping/project/i/ai-manager/.planning/PROJECT.md`
