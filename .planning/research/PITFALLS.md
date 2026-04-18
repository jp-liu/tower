# Domain Pitfalls: Image Paste in Existing Chat System

**Domain:** Adding image paste to an existing SSE-streaming chat with Claude Agent SDK backend
**Researched:** 2026-04-18
**Project:** Tower v0.93 Chat Media Support

> This file supersedes the v0.9 PITFALLS.md (adapter cleanup + external dispatch). v0.9 pitfalls remain valid for that milestone but are not repeated here. This document covers only the net-new risks introduced by v0.93's image paste feature.

---

## Critical Pitfalls

Mistakes that cause API errors, data loss, security vulnerabilities, or regressions in the existing chat.

---

### Pitfall 1: base64 Data URI Prefix Sent to Claude API

**Severity:** CRITICAL
**Phase:** SDK integration (constructing the image content block)

**What goes wrong:**
`FileReader.readAsDataURL()` — the most discoverable way to convert a File to base64 — returns a string like `data:image/png;base64,iVBOR...`. If this full string is passed as the `data` field in a Claude API image content block, the API returns a 400 error. The `data` field must be the raw base64 payload only; the `data:...;base64,` prefix must be stripped.

**Why it happens:**
Developers reach for `readAsDataURL` because it is the standard browser API. The prefix is visually obvious in the console but easy to miss when base64 data is logged truncated. Two confirmed bugs in the anthropics/claude-code repository (#7088, #11936) show this exact mistake.

**Consequences:**
Every message with an attached image fails with a misleading 400 error that says "Invalid image media type" or "image cannot be empty" — the actual cause (the prefix) is not surfaced in the error message.

**Prevention:**
```typescript
// WRONG
const dataUrl = await readAsDataURL(file); // "data:image/png;base64,iVBOR..."
const data = dataUrl; // includes prefix — API rejects this

// CORRECT
const dataUrl = await readAsDataURL(file);
const data = dataUrl.split(",")[1]; // raw base64 only
```

When saving to disk first (the preferred pattern for this project), skip `readAsDataURL` entirely and use `file.arrayBuffer()` → `Buffer.from(...).toString("base64")` server-side.

**Detection:**
API 400 response body mentions "invalid" or "empty". Log the first 20 chars of the data field: if it starts with `"data:"` rather than `"iVBOR"` (PNG) or `"/9j/"` (JPEG), the prefix is present.

---

### Pitfall 2: MIME Type Taken from Browser's `file.type` (Not Actual File Bytes)

**Severity:** CRITICAL
**Phase:** Upload/save phase AND SDK integration phase

**What goes wrong:**
`File.type` in a paste event comes from the browser's clipboard metadata — not from reading the file's actual bytes. An attacker (or a buggy clipboard source) can produce a File object claiming `type = "image/png"` whose bytes are actually JPEG, SVG, or something else entirely. Two failure modes:

1. Claude API 400: "Image media type mismatch" — the API validates that the declared `media_type` matches the actual image bytes. GitHub issue #11936 is this exact bug.
2. Security: An SVG file disguised as a PNG can contain embedded JavaScript. If stored to `.cache/images/` and served from a route without `Content-Type: image/svg+xml`, the browser may execute the scripts.

**Why it happens:**
MIME type on clipboard File objects is set by the OS/browser from the clipboard format declaration, not from reading file content. On macOS, screenshots paste as genuine PNG. But "paste from URL" or "paste from another app" can produce mismatches.

**Consequences:**
API rejections with misleading error messages. SVG-based stored XSS if SVG is not explicitly blocked.

**Prevention:**
1. Server-side: read the first 12 bytes (magic bytes) to verify the actual format before saving.
   - PNG: `\x89PNG\r\n\x1a\n`
   - JPEG: `\xFF\xD8\xFF`
   - GIF: `GIF87a` or `GIF89a`
   - WebP: `RIFF....WEBP`
2. Allowlist: only accept `image/jpeg`, `image/png`, `image/gif`, `image/webp` — the four formats Claude supports. Reject everything else (especially SVG).
3. Use the server-verified MIME type (not `file.type`) when constructing the `media_type` field in the Claude API content block.

**Detection:**
API 400 with "media_type" in the error body. Test by renaming a JPEG to `.png` and pasting it — should be caught and corrected at the server.

---

### Pitfall 3: Blob URL Memory Leak — Never Revoked Preview URLs

**Severity:** CRITICAL
**Phase:** UI preview phase (thumbnail strip)

**What goes wrong:**
`URL.createObjectURL(file)` allocates a reference-counted memory object that persists until either `URL.revokeObjectURL()` is called or the document unloads. Tower's `AssistantProvider` context persists across route changes (by design — chat history survives navigation). Every image paste adds a blob URL to memory. In a long session with many pastes (screenshots during AI debugging, diagrams, etc.), blob URLs accumulate without bound.

A confirmed real-world consequence is documented in react-dropzone issue #398 (accumulates on every file drop without revoke), and `ERR_OUT_OF_MEMORY` is the eventual result in long SPA sessions.

**Why it happens:**
The natural pattern is: create blob URL → set as `<img src>` → move on. Cleanup requires explicit bookkeeping across React state updates and component unmounts, which is easy to overlook when the state lives in a context provider rather than a local component.

**Consequences:**
Progressive memory growth. On machines with 8–16 GB RAM it manifests as tab slowdown after 30+ minutes. On resource-constrained systems, the tab crashes. The leak is invisible during development (short sessions, Chrome DevTools forces GC on page reload).

**Prevention:**
```typescript
// When adding an image to the pending list:
const previewUrl = URL.createObjectURL(file);
setPendingImages(prev => [...prev, { file, previewUrl, cachePath: null }]);

// When removing an image:
function removeImage(index: number) {
  setPendingImages(prev => {
    URL.revokeObjectURL(prev[index].previewUrl); // revoke on removal
    return prev.filter((_, i) => i !== index);
  });
}

// After send completes — revoke ALL remaining preview URLs:
function clearAfterSend(images: PendingImage[]) {
  images.forEach(img => URL.revokeObjectURL(img.previewUrl));
}

// useEffect cleanup — handles unmount:
useEffect(() => {
  return () => {
    pendingImages.forEach(img => URL.revokeObjectURL(img.previewUrl));
  };
}, []); // run only on unmount
```

Revoke AFTER the `<img>` element's `onLoad` fires, not before — revoking too early breaks the image render.

**Detection:**
Chrome DevTools Memory tab → "Take Heap Snapshot" before and after multiple paste+send cycles. Compare `Blob` object count. A properly implemented version shows 0 Blobs after send; a leaking implementation shows N * pastes.

---

### Pitfall 4: Sending Inline base64 in the Chat API Request Body

**Severity:** CRITICAL
**Phase:** API design phase (how images travel from browser to SDK)

**What goes wrong:**
The tempting shortcut is to base64-encode the image client-side and embed it directly in the existing `POST /api/internal/assistant/chat` JSON body alongside the text message. This approach has three compounding problems:

1. **Request size**: A 2 MB screenshot becomes ~2.7 MB of JSON (base64 inflates by ~33%). The Next.js App Router has a default body size limit; large images hit it immediately.
2. **Multi-turn history bloat**: The Claude Agent SDK maintains conversation context across turns. If the image bytes are embedded in the user message, they are re-sent in the conversation history on every subsequent message. A 3-image session sends 3x the image bytes on every subsequent turn.
3. **Payload cap**: The Claude API enforces a 32 MB total request size limit for standard endpoints. With multiple large images in history, this limit is reached faster than expected.

**Why it happens:**
The chat route already accepts JSON body. Adding a `{ message, sessionId, images: [{ data, mimeType }] }` field feels like the minimal diff. The cumulative history cost is invisible until the conversation is several turns deep.

**Consequences:**
HTTP 413 (Next.js body limit) or Claude API 400 (payload too large) after a few turns in image-heavy sessions. Silent quality degradation as the model receives less context because image tokens dominate the window.

**Prevention:**
Save the image to `.cache/images/uuid.ext` server-side first. Pass only the absolute filesystem path to the SDK's `query()` call. The Claude Agent SDK subprocess has filesystem access and can read the file directly. This is consistent with the existing Tower pattern of passing file paths for assets (see `asset-actions.ts`).

The chat route API contract becomes:
```
POST /api/internal/assistant/chat
{ message: string, sessionId?: string, imagePaths?: string[] }
```

The server reads the files by path, constructs the image content blocks (reading bytes, base64-encoding, applying magic byte verification), and passes them to the SDK. Image bytes never travel over HTTP.

**Detection:**
Network tab shows chat requests > 500 KB. Subsequent turns in multi-image conversations become progressively larger. API error after the 3rd or 4th turn in an image session.

---

### Pitfall 5: Path Traversal via Paste-Supplied Filename Used as Cache Filename

**Severity:** CRITICAL (security)
**Phase:** Upload/save phase

**What goes wrong:**
When saving a pasted image to `.cache/images/`, if any part of the filename is derived from the browser-supplied `file.name`, an attacker can craft a paste that writes files outside the cache directory. For example, `file.name = "../../config/settings.json"` would resolve outside the intended directory. This exact vulnerability class is already mitigated in `asset-actions.ts` using `path.basename()` + containment check — but that guard only exists there. A new cache-save function starts without it.

**Why it happens:**
Browser File objects from paste events have a `name` property. For screenshots, macOS sets this to `"image.png"`, which looks safe. But the File API does not guarantee this value; any clipboard source can set it to an arbitrary string.

**Consequences:**
Server-side arbitrary file write to any path the Next.js process user has write access to. In a local dev tool running as the developer's user, this means the entire home directory.

**Prevention:**
Generate a UUID-based filename server-side. Never use the browser-supplied `file.name` for the cache path. The extension is derived from the server-verified MIME type (not from the name).

```typescript
import { randomUUID } from "crypto";

const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

function safeCacheFilename(verifiedMimeType: string): string {
  const ext = EXT_MAP[verifiedMimeType] ?? "bin";
  return `${randomUUID()}.${ext}`;
}

// Always verify containment:
const dest = path.join(cacheDir, safeCacheFilename(mimeType));
if (!dest.startsWith(cacheDir + path.sep)) throw new Error("Path escape");
```

This same pattern is used in `asset-actions.ts` and must be applied identically to the new cache route.

**Detection:**
Pass `"../../etc/passwd"` as the file name in a test. Verify the file is written inside `cacheDir`, not at the traversed path.

---

## Moderate Pitfalls

---

### Pitfall 6: Paste Event Handler Swallows Text Paste

**Severity:** MODERATE
**Phase:** UI paste handler phase

**What goes wrong:**
Adding `onPaste` to the existing `<Textarea>` and calling `e.preventDefault()` unconditionally breaks ordinary text paste. The textarea no longer accepts Ctrl+V for text after the handler is added.

**Why it happens:**
`e.preventDefault()` on a paste event suppresses the browser's default paste behavior entirely, including inserting pasted text. If the handler intercepts the event regardless of whether an image is present, text paste is broken.

**Prevention:**
Call `e.preventDefault()` only when image items are found. Let text pastes fall through to default browser behavior.

```typescript
function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
  const items = Array.from(e.clipboardData.items);
  const imageItems = items.filter(
    item => item.kind === "file" && item.type.startsWith("image/")
  );

  if (imageItems.length === 0) return; // text paste — do nothing, let default proceed

  e.preventDefault(); // only intercept when images are present
  imageItems.forEach(item => {
    const file = item.getAsFile();
    if (file) addPendingImage(file);
  });
}
```

**Detection:**
After adding the handler, verify that Ctrl+V for text still works. Test: copy a word, paste into the textarea — it must appear in the input.

---

### Pitfall 7: Firefox Double-File Bug on Clipboard Image Paste

**Severity:** MODERATE
**Phase:** UI paste handler phase

**What goes wrong:**
Firefox bug #1290688: pasting an image from clipboard produces two entries in `clipboardData.files` and three entries in `clipboardData.types`. Iterating `clipboardData.files` instead of filtering `clipboardData.items` causes a single paste to add two thumbnail entries in Firefox.

**Why it happens:**
Firefox represents the clipboard image as both a `File` in the `files` list and as an `item` in the `items` list. Reading `files` directly doubles the image.

**Prevention:**
Always iterate `clipboardData.items`, filtering by `kind === "file"` and `type.startsWith("image/")`. Never iterate `clipboardData.files` for paste handling.

**Detection:**
In Firefox, a single Ctrl+V paste shows two identical thumbnails in the preview strip.

---

### Pitfall 8: Race Condition — Send Before File Write Completes

**Severity:** MODERATE
**Phase:** UI state + save phase

**What goes wrong:**
The user pastes an image (which triggers an async server-side save to `.cache/images/`) then immediately presses Enter. The `sendMessage` call fires before the write promise resolves. The image path passed to the SDK points to a file that does not yet exist on disk. The Claude subprocess reads nothing and either errors or processes the message without the image.

**Why it happens:**
The thumbnail preview is available instantly (blob URL from browser memory). The user sees the image in the strip and assumes it is ready. The async write is invisible. There is no spinner on the thumbnail to indicate in-flight upload.

**Consequences:**
The AI receives the text message but not the image. The user receives a response that ignores the image they clearly attached. Confusing UX, no error shown.

**Prevention:**
Track upload state per pending image. The Send button remains enabled (for UX), but `sendMessage` awaits all in-flight write promises before dispatching to the SDK.

```typescript
interface PendingImage {
  previewUrl: string;       // blob URL — available immediately
  uploadPromise: Promise<string>; // resolves to absolute cache path
  cachePath: string | null; // null until resolved
}

async function handleSend() {
  const text = inputValue.trim();
  if (!text && pendingImages.length === 0) return;

  // Await all in-flight writes first
  const resolvedPaths = await Promise.all(
    pendingImages.map(img => img.uploadPromise)
  );

  sendMessage(text, resolvedPaths);
  clearPendingImages(); // also revokes blob URLs
  setInputValue("");
}
```

Show a subtle upload indicator (e.g., spinner overlay on thumbnail) while `uploadPromise` is pending.

**Detection:**
Paste a large image and immediately send. The AI response must reference the image content. If it says "I don't see an image", the race condition is present.

---

### Pitfall 9: Image File Size Not Validated — API Limit Exceeded

**Severity:** MODERATE
**Phase:** Upload/save phase

**What goes wrong:**
A 4K screenshot (3840x2160 PNG) can be 10–20 MB. The Claude API enforces an 8 MB per-image limit for base64-encoded images in the standard messages endpoint. Larger images cause a 400 error. The existing `uploadAsset` uses a configurable `system.maxUploadBytes` limit (default 50 MB) — too large for chat image use.

**Why it happens:**
The existing upload limit is designed for project assets (documents, large files). Chat images have a different constraint set by the downstream API.

**Consequences:**
API 400 "Image exceeds size limit" when the user pastes a large screenshot. The error surfaces as a chat error message after the user has already waited for the response.

**Prevention:**
1. Client-side: check `file.size > 8_000_000` before uploading and show an inline warning: "Image too large (max 8 MB). It will be resized." Consider canvas-based client-side resize to cap the long edge at 1568px (the maximum Claude processes anyway).
2. Server-side: enforce a hard 10 MB limit in the cache image write route as a backstop.
3. Optional optimization: downscale to ≤1568px long edge before sending to Claude — images larger than this are silently downscaled by the API with no quality benefit and wasted token cost.

**Detection:**
Paste a screenshot > 8 MB. The expected behavior is a clear user-facing warning before or during upload, not a confusing API error after sending.

---

### Pitfall 10: Claude Agent SDK `query()` Does Not Accept File Path References Directly

**Severity:** MODERATE
**Phase:** SDK integration phase

**What goes wrong:**
The existing `query()` call in `assistant/chat/route.ts` accepts a `prompt` string. The Claude Agent SDK's `query()` function signature may not have a built-in `images` parameter accepting filesystem paths — the image content must be constructed as part of the message content array. If the integration blindly passes `imagePaths` as a top-level `query()` option, it will be silently ignored.

**Why it happens:**
The Claude Agent SDK is different from the Anthropic Messages API client. The `query()` function in `@anthropic-ai/claude-agent-sdk` spawns a Claude CLI subprocess. Image injection may need to happen at the prompt level (by including image content in the `prompt` parameter as a structured format) or through a CLI-specific mechanism.

**Consequences:**
Images are silently dropped — the AI responds to the text only, with no indication that images were not received.

**Prevention:**
Verify the exact `query()` API signature for image support before implementing. Check `node_modules/@anthropic-ai/claude-agent-sdk` for the `QueryOptions` type definition. If the SDK does not have native image support, fall back to writing image data as a formatted system prompt reference or use the `--add-image` CLI flag if the underlying `claude` binary supports it.

This is a HIGH-priority investigation item that should be validated before committing to any architecture. If the SDK path reference approach does not work, the implementation strategy changes significantly.

**Detection:**
Add a test: send a message with one attached image (known path), verify the assistant's response describes the image content. If the response is image-agnostic ("I don't see any image attached"), the SDK integration is not passing images correctly.

---

### Pitfall 11: Existing `sendMessage(text)` Signature Must Be Extended Without Breaking Callers

**Severity:** MODERATE
**Phase:** Hook and API extension phase

**What goes wrong:**
`useAssistantChat.sendMessage` currently has the signature `(text: string) => void`. Extending it to `(text: string, imagePaths?: string[]) => void` is safe if no external callers rely on the exact type. However, `AssistantProvider` wraps this hook and exposes `sendChatMessage` to the rest of the app. If the signature change is not propagated consistently (hook → provider → consumer components), TypeScript will error, but only at build time — not at runtime if callers are in `.tsx` files without strict checking.

**Why it happens:**
The chat state lives in `AssistantProvider` which re-exports `sendChatMessage`. Any component calling `sendChatMessage` must be updated when the signature changes. The call site in `assistant-chat.tsx` is the primary one, but future features may add more.

**Prevention:**
When extending `sendMessage`, update the type in `UseAssistantChatReturn`, propagate to `AssistantProvider`'s context type, and run `tsc --noEmit` to surface all out-of-date call sites before the PR.

**Detection:**
`tsc --noEmit` errors mentioning "Expected 1 arguments, but got 2" at call sites that have not been updated.

---

## Minor Pitfalls

---

### Pitfall 12: Preview Strip Causes Layout Overflow in Narrow Sidebar

**Severity:** MINOR
**Phase:** UI preview phase

**What goes wrong:**
The chat input area in the sidebar panel has `max-h-[120px]` on the textarea. Adding a horizontal thumbnail strip above or below the textarea with multiple images (each 56px tall) may push the send button off-screen or cause the input area to overflow the panel boundaries in the sidebar (320px wide mode).

**Prevention:**
Design the thumbnail strip as a fixed-height row (56–64px) that appears above the textarea only when `pendingImages.length > 0`. Thumbnails use horizontal scroll if there are many images. Cap at 5 images with an inline "max images reached" message to prevent overflow. Test in the 320px sidebar width.

**Detection:**
With 3+ images pasted, the send button is no longer visible without scrolling the input area.

---

### Pitfall 13: i18n Keys Missing for New Image UI Strings

**Severity:** MINOR
**Phase:** UI preview phase

**What goes wrong:**
Tower requires all user-facing strings to use `t("key")` with both `zh` and `en` translations. New UI elements added for image paste — remove button tooltip, max images warning, file too large warning, paste hint in the empty input placeholder — will show raw English strings in Chinese locale if translation keys are omitted.

**Prevention:**
Add all new keys to both locale files before writing the JSX. Keys needed at minimum:
- `assistant.imageTooLarge`
- `assistant.maxImagesReached`
- `assistant.removeImage` (aria-label)
- `assistant.imageUploading`

**Detection:**
Switch locale to Chinese. Any untranslated English strings in the chat input area indicate missing keys.

---

### Pitfall 14: Thumbnail `<img>` Flashes Broken-Image Icon Before Load

**Severity:** MINOR
**Phase:** UI preview phase

**What goes wrong:**
Without explicit dimensions on the thumbnail container, the `<img src={blobUrl}>` renders at 0 height and flashes the broken-image icon until the blob URL resolves. This is jarring for large images where the blob URL is created asynchronously.

**Prevention:**
Blob URLs are synchronous — `URL.createObjectURL()` returns immediately. The image render is instant. Use fixed container dimensions (`w-14 h-14` with `object-cover`) to avoid the flash from unsized containers.

**Detection:**
Paste a large image and observe the thumbnail strip for a size jump after the image loads.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Textarea `onPaste` handler | Pitfall 6: text paste broken | Only call `e.preventDefault()` when image items are found |
| Textarea `onPaste` handler | Pitfall 7: Firefox double-file | Iterate `clipboardData.items`, not `clipboardData.files` |
| Blob URL thumbnail preview | Pitfall 3: memory leak | `useEffect` cleanup revokes all blob URLs; revoke on removal and after send |
| Thumbnail strip layout | Pitfall 12: overflow in sidebar | Fixed-height strip, horizontal scroll, 5-image cap |
| i18n compliance | Pitfall 13: missing keys | Add zh/en keys before writing JSX |
| Cache file save route | Pitfall 5: path traversal | UUID filename server-side; containment check; never use browser `file.name` |
| Cache file save route | Pitfall 2: MIME spoofing + SVG XSS | Magic byte verification; reject SVG; use verified MIME as `media_type` |
| Cache file save route | Pitfall 9: image too large | Client warn + server enforce 8 MB limit; optionally resize to ≤1568px |
| Async save + send ordering | Pitfall 8: race condition | `sendMessage` awaits all `uploadPromise` before dispatching |
| Claude SDK integration | Pitfall 10: SDK doesn't accept file paths natively | Verify `query()` type signature before implementing; test end-to-end early |
| Claude SDK integration | Pitfall 1: base64 prefix | Strip `data:...;base64,` prefix if base64 path used; prefer server-side read |
| Claude SDK integration | Pitfall 4: inline base64 bloat | Pass file path to subprocess, not base64; keep JSON body < 100 KB |
| Hook/provider extension | Pitfall 11: signature mismatch | Run `tsc --noEmit` after extending `sendMessage` signature |

---

## Quick-Reference Checklist

### Phase: UI paste handler
- [ ] `e.preventDefault()` only when `imageItems.length > 0`
- [ ] Iterate `clipboardData.items`, not `clipboardData.files`
- [ ] Blob URL revoked on: image removed, send completed, component unmounted
- [ ] Text paste still works after handler is added

### Phase: File save to cache
- [ ] Filename is `randomUUID().ext` — never browser `file.name`
- [ ] Extension from server-verified MIME map (4 allowed types only)
- [ ] Magic bytes verified before saving
- [ ] `dest.startsWith(cacheDir + path.sep)` containment check
- [ ] File size ≤ 8 MB enforced server-side

### Phase: SDK integration
- [ ] Verify `query()` accepts image content before committing to architecture
- [ ] base64 prefix stripped if base64 path used
- [ ] `media_type` from server-verified MIME, not `file.type`
- [ ] Image bytes not embedded in JSON body (use file path)
- [ ] `sendMessage` awaits all upload promises before dispatching

---

## Sources

- [Anthropic Vision API Docs](https://platform.claude.com/docs/en/build-with-claude/vision) — HIGH confidence (official docs, verified 2026-04-18); image size limits, supported MIME types, base64 format requirements
- [GitHub: Image media type mismatch #11936](https://github.com/anthropics/claude-code/issues/11936) — HIGH confidence (confirmed bug report: media_type mismatch from base64 prefix)
- [GitHub: Invalid image media type #7088](https://github.com/anthropics/claude-code/issues/7088) — HIGH confidence (confirmed bug report: same class of error)
- [MDN: Element paste event](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event) — HIGH confidence (official); `clipboardData.items` vs `files` semantics
- [MDN: URL.revokeObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static) — HIGH confidence (official); blob URL lifecycle
- [Firefox bug #1290688: Double clipboardData.files on image paste](https://bugzilla.mozilla.org/show_bug.cgi?id=1290688) — HIGH confidence (confirmed browser bug; affects clipboard.files iteration)
- [react-dropzone memory leak #398](https://github.com/react-dropzone/react-dropzone/issues/398) — MEDIUM confidence (community issue confirming blob URL accumulation in React)
- [File Uploads in Node.js the Safe Way](https://dev.to/prateekshaweb/file-uploads-in-nodejs-the-safe-way-validation-limits-and-storing-to-s3-4a86) — MEDIUM confidence (community; verified against project's existing `uploadAsset` patterns)
- [React IME composition issue #8683](https://github.com/facebook/react/issues/8683) — HIGH confidence (confirmed React issue; matches existing `isComposing` guard in `assistant-chat.tsx`)
- Codebase: `src/app/api/internal/assistant/chat/route.ts` — direct inspection of existing `query()` call signature and SSE streaming pattern
- Codebase: `src/actions/asset-actions.ts` — direct inspection of existing path traversal mitigations (`path.basename`, containment check, UUID not used but timestamp-dedup pattern present)
- Codebase: `src/hooks/use-assistant-chat.ts`, `src/components/assistant/assistant-chat.tsx` — direct inspection of current `sendMessage(text: string)` signature and textarea IME guard
