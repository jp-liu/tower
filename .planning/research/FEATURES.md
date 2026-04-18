# Feature Landscape: Chat Image Paste Support

**Domain:** Chat input media attachment — image paste from clipboard
**Researched:** 2026-04-18
**Milestone:** v0.93 Chat Media Support
**Confidence:** HIGH (clipboard API behavior from official sources; UX patterns from multiple AI chat products; codebase integration points from direct inspection)

> Note: This file replaces the v0.9 research. Prior v0.9 research is embedded in git history.

---

## Context: What Exists

The assistant chat (`AssistantChat` + `AssistantProvider`) currently:
- Uses a `<Textarea>` for input (not a contenteditable div)
- Calls `sendChatMessage(text: string)` — text-only API, lives in `assistant-provider.tsx`
- POSTs to `/api/internal/assistant/chat` with `{ message, sessionId }`
- Has existing `ProjectAsset` infrastructure with `data/assets/<projectId>/` storage
- Has `data/cache/` as an established cache directory concept

The milestone scope is deliberate and narrow:
- Images only (not other file types)
- Paste (Ctrl+V / Cmd+V) only — drag-and-drop is explicitly deferred
- Cache to `data/cache/images/<uuid>.<ext>` before sending to AI
- Move-to-project-assets is a downstream MCP concern, not this milestone's UI concern

---

## Table Stakes

Features users consider mandatory. Without them, the feature feels broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Ctrl+V intercept on textarea | Every AI chat (ChatGPT, Claude.ai, Gemini) supports this — it is the baseline expectation in 2025+ | Low | `onPaste` handler on `<Textarea>`; filter `e.clipboardData.items` for `type.startsWith("image/")` |
| Thumbnail preview before send | Users need visual confirmation they captured the right image; every mainstream AI chat shows this | Medium | `URL.createObjectURL(blob)` for in-memory preview; render as `<img>` at ~60×60px; revoke URL on remove/send |
| Remove image before send | User pasted wrong screenshot — must discard without clearing the text input | Low | X button on each thumbnail; splice from `pendingImages[]` state |
| Preview strip above textarea | Standard placement across ChatGPT, Claude.ai, Gemini: thumbnails sit between message list and textarea | Low | Horizontal scroll row (`flex overflow-x-auto`), only rendered when `pendingImages.length > 0` |
| Images clear after send | Pending images reset after the message is dispatched | Low | `setPendingImages([])` in `handleSend` after `sendMessage()` call |
| Accept only image MIME types | Non-image clipboard content (files, HTML, plain text) must not trigger image paste logic | Low | `item.type.startsWith("image/")` guard; silently ignore everything else so text paste still works |
| Server-side image storage before send | `object-url` blobs are ephemeral; image must be persisted before being passed to the AI | Medium | New `POST /api/internal/assets/cache-image` route; write to `data/cache/images/<uuid>.<ext>`; return stable path |
| Pass image paths to AI in chat API | Claude SDK must receive image file paths as context alongside the text | Medium | Extend `sendChatMessage(text, imagePaths[])` and the `/api/internal/assistant/chat` POST body; verify Claude SDK accepts local file paths |

---

## Differentiators

Features not universally expected but meaningfully improve the experience.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Multiple images per message | Power users compare screenshots (UI bugs, design feedback); multi-image is inherent once state is an array | Low | No extra work — `pendingImages` is an array; strip naturally shows N items |
| Image filename / dimensions on thumbnail hover | Helps confirm the right file was captured, especially similar-looking screenshots | Low | `title` attribute on the `<img>` or a tooltip; no extra UI component needed |
| Paste from right-click context menu | Some users right-click → Paste rather than Ctrl+V; same `onPaste` event fires for both | None | Browser already normalizes both into the same `paste` event — zero extra work |
| Allow send with images and no text | Users want to ask "what do you see in this screenshot?" with image only | Low | Change `isSendDisabled` from `!inputValue.trim() \|\| isThinking` to `(!inputValue.trim() && pendingImages.length === 0) \|\| isThinking` |
| Keyboard shortcut hint in placeholder | Subtly educates users that image paste is supported | None | i18n string change only: add "/ 粘贴图片 Ctrl+V" to `assistant.inputPlaceholder` |
| Size limit with clear error | Images over limit (suggest 10 MB) are rejected immediately with a toast, not silently dropped | Low | Check `file.size` in the paste handler; call `toast.error(t("assistant.imageTooLarge"))` if exceeded |

---

## Anti-Features

Explicitly out of scope for this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Drag-and-drop image upload | Adds drop zone overlay, event cancellation complexity, visual drop indicator | Defer; stated out of scope in PROJECT.md |
| Non-image file attachments | Different storage treatment, different AI API handling, different preview UX | For non-image paste, silently ignore (text pastes normally into textarea) |
| Image resize / crop before send | Canvas processing step; heavyweight for a localhost tool; users can re-screenshot | Not in scope; apply size limit instead |
| EXIF / metadata stripping | Privacy concern but irrelevant for a localhost single-user tool | Not in scope |
| Image compression before upload | Adds canvas + blob conversion step; Claude accepts full-res; size limit is the correct gate | Not in scope |
| View pasted image history across sessions | Persistent gallery UI; cache is intentionally ephemeral | Not in scope; cache cleanup is manual per PROJECT.md |
| Automatic cache cleanup on send | Milestone explicitly defers cache cleanup to manual user action | Files remain in `data/cache/images/` after send |
| Inline image rendering in the sent user message bubble | `AssistantChatBubble` already handles image markdown rendering (v0.2 feature); the user bubble can show a small preview or path reference | Separate rendering concern; not in this milestone |
| Pasting video / audio | Entirely different media handling, streaming, and AI API considerations | Explicitly out of scope in PROJECT.md |

---

## Feature Dependencies

```
Paste event intercept (onPaste on <Textarea>)
  └── MIME type filter: item.type.startsWith("image/")
       └── File blob → URL.createObjectURL → preview thumbnail
            └── pendingImages[] state (array of { blob, objectUrl, name, size })
                 ├── Preview strip UI (horizontal scroll row)
                 │    └── Per-image X button → splice from pendingImages[]
                 └── handleSend → POST each blob to /api/internal/assets/cache-image
                                   └── Receives: { path: "data/cache/images/uuid.ext" }
                                        └── sendChatMessage(text, [paths])
                                             └── Provider POST body: { message, sessionId, images: paths[] }
                                                  └── /api/internal/assistant/chat route
                                                       └── Claude SDK query() receives images as references
```

Existing infrastructure reused without changes:
- `data/` directory convention — cache images go in `data/cache/images/`
- `requireLocalhost` + CUID validation pattern for internal API routes
- `ensureAssetsDir` pattern — replicate as `ensureCacheImagesDir`
- Zod validation in server actions and API routes
- `toast.error()` via Sonner for user-facing validation errors
- i18n `t("key")` pattern for all new strings

---

## UX Behavior Specification

Based on ChatGPT, Claude.ai, and Gemini patterns (HIGH confidence — direct product observation):

**Happy path:**
1. User takes a screenshot (Cmd+Shift+4, PrtSc, or right-click → Copy Image).
2. User clicks inside the chat textarea and presses Ctrl+V (or Cmd+V on Mac).
3. Immediately: a thumbnail strip appears above the textarea showing the image at ~60×60px. No text is inserted into the textarea.
4. User types their question (or leaves it blank).
5. User presses Enter or clicks Send.
6. Each pending image is uploaded to `data/cache/images/` (sequential, not parallel, to preserve order).
7. Object URLs are revoked, `pendingImages[]` is cleared.
8. Message is sent with `{ message: text, sessionId, images: ["/path/to/uuid.ext", ...] }`.
9. Chat shows the user message bubble. AI responds with content referencing the image.

**Edge cases:**
- Ctrl+V with text in clipboard: text pastes into textarea normally; paste handler sees no image items and returns without touching `pendingImages[]`.
- Second image paste while images are already pending: append to strip (multi-image).
- Image over size limit: `toast.error(...)`, image not added to strip.
- Non-image file pasted: silently ignore.
- Cancel / stop while images are pending: `pendingImages[]` stays; user can still see the thumbnails.
- Sending while AI is thinking (`isThinking`): Send button is disabled; paste into strip is allowed (user can queue up images for next send).

---

## MVP Recommendation

Implement in this order to validate each layer before building the next:

1. **Preview strip + paste intercept** — The entire visible UX. Uses `object-url` blobs in memory only, no server calls. Validates the paste interaction before committing to storage work.

2. **Cache storage API** — `POST /api/internal/assets/cache-image` route. Accepts multipart image blob, writes to `data/cache/images/<uuid>.<ext>`, returns path. Validates storage approach in isolation.

3. **Extended sendChatMessage + chat API** — Add `imagePaths?: string[]` to `sendChatMessage`, the provider fetch body, the API route handler, and the Claude SDK call. This is where images become actual AI context. The Claude SDK image reference format (file path vs base64 vs URL) must be verified here — it is the highest-uncertainty item.

**Defer:**
- Keyboard shortcut hint in placeholder (i18n string, zero complexity, any phase)
- Allow send with images and no text (UX edge case, defer until testing reveals demand)
- Inline image in sent message bubble (separate rendering concern)

---

## Complexity Assessment

| Feature | Effort | Risk |
|---------|--------|------|
| Paste event intercept + MIME filter | 1–2 hours | Low — standard browser API, well-documented |
| Preview strip UI + remove button | 2–3 hours | Low — simple flex row, object-url pattern |
| Cache storage API route | 2–3 hours | Low — follows existing internal API patterns |
| sendChatMessage signature extension | 2–3 hours | Low — additive change, provider + route |
| Claude SDK image reference passing | 2–4 hours | Medium — format (path/base64/URL) must be verified against SDK docs |
| **Total** | **~9–15 hours** | Medium (SDK format is the uncertainty) |

The Claude SDK image reference format is the single highest-uncertainty item. It should be verified in Phase 1 or early Phase 2 before the send pipeline is built.

---

## Sources

- [GitHub: Feature Request — Ctrl+V smart paste images and files from clipboard (anthropics/claude-code #27564)](https://github.com/anthropics/claude-code/issues/27564)
- [GitHub: Screenshot Support via Clipboard Paste in Claude Code CLI (anthropics/claude-code #12644)](https://github.com/anthropics/claude-code/issues/12644)
- [GitHub: IntelliJ plugin — no support for pasting images into chat input (anthropics/claude-code #33005)](https://github.com/anthropics/claude-code/issues/33005)
- [web.dev: How to paste images — Clipboard API patterns](https://web.dev/patterns/clipboard/paste-images)
- [MDN: Element paste event — clipboardData.items API](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event)
- [W3C Clipboard API and Events specification](https://www.w3.org/TR/clipboard-apis/)
- [Cursor Community: Paste image to chat from clipboard (feature request discussion)](https://forum.cursor.com/t/paste-image-to-chat-from-clipboard/1823)
- Tower codebase: `src/components/assistant/assistant-chat.tsx`, `src/components/assistant/assistant-provider.tsx`, `src/actions/asset-actions.ts` — direct inspection, 2026-04-18
- Tower PROJECT.md: v0.93 milestone scope, existing infrastructure, constraints — direct inspection, 2026-04-18
