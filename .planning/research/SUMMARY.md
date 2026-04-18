# Project Research Summary

**Project:** Tower — Chat Media Support (v0.93)
**Domain:** Multimodal input integration for an existing SSE-streaming chat with Claude Agent SDK backend
**Researched:** 2026-04-18
**Confidence:** HIGH

## Executive Summary

Tower v0.93 adds image paste support to the existing assistant chat. The feature is deliberately narrow: clipboard paste only (no drag-and-drop), images only (no other file types), with temporary cache storage in `data/cache/assistant/` and no persistent DB records. All required infrastructure already exists in the codebase — browser Clipboard API, the `data/cache/` directory convention, and the Claude Agent SDK's `AsyncIterable<SDKUserMessage>` multimodal prompt path. Zero new npm dependencies are required.

The recommended implementation strategy is a strict server-first architecture: images are uploaded to the server cache immediately on paste (not at send time), assigned UUID-based filenames, and passed to the Claude Agent SDK as base64-encoded content blocks built server-side from the cached files. The browser never holds image bytes after the initial upload — it keeps only a blob URL for thumbnail preview and the filename reference. This avoids the three most serious pitfalls: inline base64 bloat in the chat request body, path traversal via browser-supplied filenames, and conversation history inflation from embedding raw image bytes across multiple turns.

The single highest-risk element is the Claude Agent SDK multimodal call path. The SDK's `query()` function must receive images as `AsyncIterable<SDKUserMessage>` with image content blocks, and base64 encoding must be done server-side from disk — not from browser `FileReader.readAsDataURL()`, which returns a `data:...;base64,` prefixed string that the Claude API rejects. This contract must be validated end-to-end in Phase 4 before the feature is considered complete. Every other element of the implementation follows well-established patterns already present in the codebase.

---

## Key Findings

### Recommended Stack

No new packages. All work is plumbing within the existing stack: Next.js App Router API routes, the `@anthropic-ai/claude-agent-sdk@0.2.114` + `@anthropic-ai/sdk@0.81.0` type system, browser-native Clipboard API and File API, and the existing `src/lib/file-utils.ts` cache directory helpers.

**Core technologies in use:**
- **Browser Clipboard API (`ClipboardEvent.clipboardData.items`)** — paste interception on the `<Textarea>` `onPaste` handler; filters by `item.kind === "file" && item.type.startsWith("image/")`; iterate `items`, never `files`, to avoid Firefox double-file bug
- **`URL.createObjectURL(file)`** — zero-roundtrip thumbnail preview; must be revoked on remove, send, and component unmount to prevent progressive memory leaks in the long-lived `AssistantProvider` context
- **`POST /api/internal/assistant/images` (new route)** — accepts `FormData { file }`, writes `data/cache/assistant/<uuid>.<ext>`, returns `{ filename, mimeType }`; follows existing `requireLocalhost` + UUID + containment-check patterns from `asset-actions.ts`; enforces magic-byte MIME verification and 8 MB hard cap
- **`@anthropic-ai/sdk` `ImageBlockParam` (base64 variant)** — `{ type: "image", source: { type: "base64", media_type, data } }` where `data` is raw base64 with no `data:...` prefix; constructed server-side by `fs.readFile()` + `buffer.toString("base64")`
- **`AsyncIterable<SDKUserMessage>`** — the multimodal prompt path for `query()`; activated only when images are present; existing string prompt path is preserved unchanged for text-only messages

### Expected Features

**Must have (table stakes):**
- Ctrl+V / Cmd+V paste intercept on the chat textarea — baseline expectation for any AI chat in 2025+
- Thumbnail preview strip above the textarea with per-image remove button
- Images cleared automatically after send (blob URLs revoked)
- Server-side cache storage before send (blob URLs cannot be passed to the SDK)
- Pass images to Claude as base64 content blocks alongside the text message
- Accept only `image/jpeg`, `image/png`, `image/gif`, `image/webp` — reject all other MIME types silently for text content, with toast for non-image files pasted

**Should have (differentiators):**
- Multiple images per message (zero extra effort — state is already an array)
- Send with images and no text ("what do you see?") — change `isSendDisabled` guard
- File size validation with clear user-facing toast error (check before upload, not after API rejects)
- Keyboard shortcut hint in textarea placeholder via i18n string change only

**Defer (v2+):**
- Drag-and-drop upload (explicitly out of scope per PROJECT.md)
- Non-image file attachments
- Image resize/crop before send
- Inline image rendering in the sent user message bubble (separate rendering concern)
- Automatic cache cleanup (deferred per PROJECT.md — manual cleanup only)
- View pasted image history across sessions

### Architecture Approach

The implementation follows a 5-stage data flow: paste event (browser) → immediate upload to server cache → blob URL thumbnail preview (local only) → send chat request with `images: string[]` array of server-absolute paths → server reads files, base64-encodes, builds `SDKUserMessage`, calls `query()`. The key architectural decision is that the browser sends only filename references, not image bytes, in the chat request — the server is the single source of truth for image data.

**Major components:**
1. **`src/app/api/internal/assistant/images/route.ts` (NEW)** — upload endpoint; writes to `data/cache/assistant/`; returns `{ filename, mimeType }`; enforces localhost-only, UUID filename, magic-byte MIME verification, 8 MB hard cap, and path containment check
2. **`src/components/assistant/image-paste-bar.tsx` (NEW)** — stateless display-only component; renders horizontal thumbnail strip with per-image X button; 48×48px fixed thumbnails with `object-cover`; mounts only when `pendingImages.length > 0`
3. **`src/components/assistant/assistant-chat.tsx` (MODIFIED)** — adds `onPaste` handler, `pendingImages` state, `uploadPromise` tracking per image, `handleSend` awaits all upload promises before dispatching
4. **`src/components/assistant/assistant-provider.tsx` (MODIFIED)** — `sendChatMessage(text, images?: string[])` signature extension; passes `images` in POST body only when non-empty
5. **`src/app/api/internal/assistant/chat/route.ts` (MODIFIED)** — reads image files from disk by path, builds `ImageBlockParam[]`, constructs `SDKUserMessage`, calls `query()` via `AsyncIterable` path when images present; existing string-prompt path untouched
6. **`src/lib/file-utils.ts` (UNCHANGED)** — `getCacheDir("assistant")` already works with "assistant" as the directory key; no modifications needed

### Critical Pitfalls

1. **base64 `data:` prefix sent to Claude API** — `FileReader.readAsDataURL()` returns `data:image/png;base64,...`; the Claude API requires raw base64 only and returns a misleading 400 error (confirmed bugs #7088, #11936). Prevention: use server-side `buffer.toString("base64")` after `fs.readFile()` — never use `readAsDataURL` in this flow.

2. **MIME type spoofed via browser `file.type`** — clipboard metadata can lie about MIME type; SVG disguised as PNG enables stored XSS. Prevention: verify magic bytes (first 12 bytes) server-side before saving; use server-verified MIME as `media_type` in the content block; explicitly reject SVG.

3. **Blob URL memory leak** — `URL.createObjectURL()` leaks if never revoked; `AssistantProvider` persists across routes, making accumulation invisible in short dev sessions. Prevention: revoke on image removal, on send completion, and in `useEffect` cleanup on unmount. Revoke only after `<img>` `onLoad` fires.

4. **Inline base64 in chat request body** — embedding image bytes in the JSON body inflates each turn by ~33% (base64 overhead) and re-sends all images in conversation history on every subsequent turn, hitting Claude's 32 MB total request limit. Prevention: pass only `string[]` paths in the request body; server reads and encodes from disk.

5. **Path traversal via browser-supplied filename** — `file.name` from a paste event can be `../../etc/passwd`. Prevention: generate `randomUUID() + verifiedExtension` server-side; never use `file.name` for the cache path; always assert `dest.startsWith(cacheDir + path.sep)` after resolving.

---

## Implications for Roadmap

Based on the architecture's dependency chain (upload API → display component → paste wiring → SDK integration), a 4-phase build order is strongly recommended. Each phase is independently testable before the next begins, with Phase 4 being the sole high-risk stage.

### Phase 1: Upload API Route
**Rationale:** No UI dependency; can be built and tested in isolation with `curl`. Establishes the cache directory contract (`data/cache/assistant/`) that all other phases depend on.
**Delivers:** `POST /api/internal/assistant/images` endpoint; `data/cache/assistant/` directory; `{ filename, mimeType }` response contract
**Addresses:** Table stakes — server-side image storage before send
**Avoids:** Pitfall 5 (path traversal — UUID filename, containment check), Pitfall 2 (MIME spoofing/SVG XSS — magic byte verification), Pitfall 9 (8 MB hard cap enforcement)

### Phase 2: Thumbnail Strip UI
**Rationale:** Pure display component with no live API dependency; develops with mock data. Validates layout in the 320px sidebar width before paste wiring adds complexity.
**Delivers:** `ImagePasteBar` component; i18n keys for all new strings in both zh/en locales; layout verified at narrow sidebar width
**Addresses:** Table stakes — visual preview before send, remove button per image
**Avoids:** Pitfall 12 (layout overflow in narrow sidebar — fixed 56px height, horizontal scroll, 5-image cap), Pitfall 13 (missing i18n keys — add zh/en before writing JSX), Pitfall 14 (thumbnail flash — fixed container dimensions `w-14 h-14`)

### Phase 3: Paste Handling + Preview Wiring
**Rationale:** Depends on Phase 1 (upload API) and Phase 2 (bar component). Wires the full paste → upload → preview → remove → send flow end-to-end, stopping before the SDK call. All visible UX is complete and testable without touching the Claude integration.
**Delivers:** Working paste intercept; thumbnails appear immediately via blob URL; upload happens in background with loading indicator; send awaits all upload promises before dispatching; text paste unbroken; blob URLs revoked correctly; `tsc --noEmit` clean after signature extension
**Addresses:** All table stakes except Claude receiving the images
**Avoids:** Pitfall 6 (text paste broken — `e.preventDefault()` only when image items found), Pitfall 7 (Firefox double-file — iterate `clipboardData.items` not `files`), Pitfall 3 (blob URL leak — revoke on remove, send, and unmount), Pitfall 8 (race condition — `sendMessage` awaits all `uploadPromise` before dispatching), Pitfall 11 (signature mismatch — run `tsc --noEmit` after extending `sendChatMessage`)

### Phase 4: Claude SDK Multimodal Integration
**Rationale:** The highest-risk phase; depends on Phases 1-3 (files must be on disk with valid paths). Modifies the chat route to read files, build `ImageBlockParam[]`, and call `query()` via `AsyncIterable<SDKUserMessage>`. Existing text-only path must remain untouched. Must be verified end-to-end with a real Claude response that describes the image before the feature is declared complete.
**Delivers:** Claude receives and correctly responds to pasted images; base64 blocks built server-side with no `data:` prefix; session resume (`sessionId`) compatible with multimodal messages; no regression on text-only messages
**Addresses:** Table stakes — images passed to AI as actual Claude vision context
**Avoids:** Pitfall 1 (base64 prefix — server-side `buffer.toString("base64")`), Pitfall 4 (inline base64 body bloat — file paths only in request), Pitfall 10 (SDK doesn't accept file paths directly — use `ImageBlockParam` in `SDKUserMessage.message.content`)

### Phase Ordering Rationale

- Phase 1 before everything else because all phases depend on the cache directory contract and the upload API response shape
- Phase 2 independently testable with mock data — UI layout validated before async upload wiring is added
- Phase 3 before Phase 4 because paste flow must be confirmed working (files genuinely on disk with valid UUIDs) before the SDK call is modified; the SDK integration failure mode (silent image drop) is only detectable when files exist on disk
- Phase 4 last because it is the only phase requiring a live SDK call for validation; all prerequisite plumbing must be stable first

### Research Flags

Needs deeper validation during planning:
- **Phase 4 (SDK integration):** The `SDKUserMessage` + `AsyncIterable` path for multimodal is confirmed in type definitions but has not been exercised in this specific codebase. Validate with a single-image smoke test before full Phase 4 implementation. The `parent_tool_use_id: null` field requirement on `SDKUserMessage` must be respected. If the Claude subprocess silently drops image blocks, investigate the `--add-image` CLI flag as a fallback.

Phases with standard patterns (skip additional research):
- **Phase 1 (Upload API):** Directly mirrors `asset-actions.ts` upload pattern with `requireLocalhost`, UUID filename, and containment check — template exists in the codebase
- **Phase 2 (UI component):** Standard React state + Tailwind flex row — well-established patterns with clear constraints
- **Phase 3 (Paste wiring):** Standard browser Clipboard API — MDN documentation is authoritative; `clipboardData.items` behavior is fully specified

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All API types verified from installed `node_modules` type definitions; no guesswork; zero new dependencies confirmed |
| Features | HIGH | Scope derived from PROJECT.md + direct codebase inspection + confirmed behavior across ChatGPT, Claude.ai, Gemini (direct observation) |
| Architecture | HIGH | All patterns validated against existing codebase; SDK type contracts read from disk; `getCacheDir("assistant")` confirmed to work without code changes |
| Pitfalls | HIGH | 5 critical pitfalls sourced from confirmed GitHub bug reports (#7088, #11936, Firefox #1290688) and official MDN/Anthropic docs |

**Overall confidence:** HIGH

### Gaps to Address

- **SDK `AsyncIterable<SDKUserMessage>` live behavior:** Type signatures confirm the call is structurally valid; whether the spawned Claude CLI subprocess correctly receives and processes base64 image blocks in practice must be verified with a Phase 4 smoke test. If image data is silently dropped, the fallback is to investigate the `--add-image` CLI flag or a file-path-based alternative if the SDK exposes one.

- **Conversation history + image token cost:** Base64 images are re-sent in conversation history on every turn (per Claude API design). This is acceptable for a localhost tool with typical conversation lengths but should be monitored. The cache cleanup strategy (currently deferred) may need to be accelerated in a follow-up if users report degraded performance in long image-heavy sessions.

- **`data/cache/assistant/` accumulation:** Files accumulate indefinitely — explicitly out of scope for this milestone per PROJECT.md. A follow-up ticket should track this for v0.94+.

---

## Sources

### Primary (HIGH confidence)
- `node_modules/.pnpm/@anthropic-ai+sdk@0.81.0.../resources/messages/messages.d.ts` — `ImageBlockParam`, `Base64ImageSource`, `MessageParam` type contracts (read from disk)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — `SDKUserMessage`, `query()` prompt signature (read from disk)
- `src/app/api/internal/assistant/chat/route.ts` — existing SSE streaming pattern and `query()` call site (direct inspection)
- `src/components/assistant/assistant-provider.tsx` + `assistant-chat.tsx` — current `sendChatMessage` signature and textarea IME guard (direct inspection)
- `src/lib/file-utils.ts` + `src/actions/asset-actions.ts` — existing cache dir helpers and upload security patterns (direct inspection)
- [Anthropic Vision API Docs](https://platform.claude.com/docs/en/build-with-claude/vision) — image size limits, supported MIME types, base64 format requirements
- [MDN Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardEvent/clipboardData) — `clipboardData.items` vs `files` semantics
- [MDN URL.revokeObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static) — blob URL lifecycle

### Secondary (MEDIUM confidence)
- [GitHub: Image media type mismatch #11936](https://github.com/anthropics/claude-code/issues/11936) — base64 prefix bug confirmed in production
- [GitHub: Invalid image media type #7088](https://github.com/anthropics/claude-code/issues/7088) — same error class confirmed in production
- [Firefox bug #1290688](https://bugzilla.mozilla.org/show_bug.cgi?id=1290688) — double-file on clipboard paste in Firefox confirmed
- [react-dropzone memory leak #398](https://github.com/react-dropzone/react-dropzone/issues/398) — blob URL accumulation in long React sessions confirmed

---
*Research completed: 2026-04-18*
*Ready for roadmap: yes*
