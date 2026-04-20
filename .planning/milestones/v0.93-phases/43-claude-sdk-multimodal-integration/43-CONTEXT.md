# Phase 43: Claude SDK Multimodal Integration - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** Auto-generated (--auto flag, recommendations auto-accepted)

<domain>
## Phase Boundary

Images attached to a chat message are passed to Claude as base64 content blocks so the AI can actually see and reason about them. This phase modifies the chat API route to read image files from the assistant cache, encode them as base64, and construct multimodal prompt content for the Claude Agent SDK `query()` call.

</domain>

<decisions>
## Implementation Decisions

### Prompt Construction
- When `imageFilenames` is present and non-empty, construct a multimodal prompt instead of a plain text prompt
- Read each image file from `data/cache/assistant/<filename>` using `fs.promises.readFile()`
- Base64-encode the buffer: `buffer.toString("base64")` — no `data:` prefix (Claude API format)
- Determine MIME type from file extension using the existing `MIME_MAP` in `file-serve.ts`
- Construct content blocks: `[{ type: "image", source: { type: "base64", media_type, data } }, { type: "text", text: prompt }]`

### SDK Query Options
- When images are present, pass the prompt as content blocks array instead of string
- Add `permissions: { allow_read: true }` to options so Claude can read images if needed (AI-02)
- Text-only messages continue to use the existing string prompt path — no modification to that code path (AI-03 backward compatibility)

### Architecture for Future Extension
- MIME type whitelist lives in `mime-magic.ts` (Phase 40) — extending it there automatically extends multimodal support (AI-03)
- No hardcoded image type list in this route — derive from the filename extension dynamically

### Claude's Discretion
- Whether to add a system message like "The user has attached images" or let Claude discover them naturally
- Error handling when an image file is missing from cache (skip silently vs error response)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/api/internal/assistant/chat/route.ts` — Current chat route with SDK `query()` integration
- `src/lib/file-utils.ts` — `getAssistantCacheDir()` for resolving cache file paths
- `src/lib/file-serve.ts` — `MIME_MAP` for extension-to-MIME lookup
- `src/lib/mime-magic.ts` — `MIME_TO_EXT` (reverse map available)

### Established Patterns
- Chat route uses `const { query } = await import("@anthropic-ai/claude-agent-sdk")`
- Prompt is passed as `prompt` field in `query()` options
- `body.imageFilenames` already parsed from POST body (added in Phase 41)

### Integration Points
- `chat/route.ts` — Main modification point: add image reading + base64 encoding before `query()` call
- Phase 40's `data/cache/assistant/` directory — source of image files
- Phase 41's `imageFilenames` in request body — input trigger

</code_context>

<specifics>
## Specific Ideas

- Keep image loading synchronous (Promise.all for parallel reads) to avoid holding the stream open while loading
- Cap at reasonable image count (e.g., 10 images max per message) to prevent excessive memory usage

</specifics>

<deferred>
## Deferred Ideas

- Video/audio media support — explicitly out of scope per REQUIREMENTS.md
- Inline image rendering in Claude's response — not in scope
- Image compression before base64 encoding — premature optimization

</deferred>
