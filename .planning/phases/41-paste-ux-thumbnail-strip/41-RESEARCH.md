# Phase 41: Paste UX & Thumbnail Strip - Research

**Researched:** 2026-04-18
**Domain:** React clipboard API, XHR upload progress, shadcn/base-ui Dialog, TailwindCSS 4 thumbnail UI
**Confidence:** HIGH

## Summary

Phase 41 is a pure frontend phase. The backend upload API (Phase 40) already exists at `/api/internal/assistant/images` and returns `{ filename, mimeType }`. This phase wires the clipboard paste event to that API, manages upload state with a custom hook, renders a thumbnail strip, and adds a preview modal.

All required shadcn components (`Dialog`, `Textarea`, `Button`) are already installed — no new registry installs are needed. The Dialog component uses `@base-ui/react/dialog` (not Radix UI) per the project's `base-nova` preset, which changes the API slightly from typical shadcn docs. The `sendChatMessage` function in `assistant-provider.tsx` currently accepts only `text: string` and must be extended to also accept optional image filenames.

The primary implementation risk is the `sendChatMessage` signature change — it touches the provider, the context type, and the call site in `assistant-chat.tsx`. Keep the change backward-compatible (optional second argument) so other callers are unaffected.

**Primary recommendation:** Create `useImageUpload` hook first, wire it into `assistant-chat.tsx`, then update `sendChatMessage` to accept `imageFilenames?: string[]`. Build `ImageThumbnailStrip` and `ImagePreviewModal` as separate small components.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Paste Event Handling**
- Add `onPaste` handler to the existing `<Textarea>` in `assistant-chat.tsx`
- Use `clipboardData.items` (not `.files`) to extract image data (Firefox compatibility per PASTE-06)
- Filter for `type.startsWith("image/")` items only — text paste passes through unaffected
- Convert clipboard item to `File` via `.getAsFile()`, then upload to `/api/internal/assistant/images`

**Upload & State Management**
- Create `useImageUpload` custom hook to manage pending images state
- Each pending image has: `{ id: string, file: File, blobUrl: string, status: "uploading" | "done" | "error", progress: number, filename?: string }`
- Use `XMLHttpRequest` (not fetch) for upload to track progress via `xhr.upload.onprogress`
- On successful upload, store the returned `filename` from the Phase 40 API response
- On send: include uploaded `filename` values in the message payload, then clear all pending images
- Revoke `URL.createObjectURL()` blob URLs on remove and on component unmount (memory cleanup)

**Thumbnail Strip UI**
- Render a horizontal flex row of 48px thumbnails above the input area (between border-t and textarea)
- Only render the strip when pending images exist (no layout shift when empty)
- Each thumbnail shows: image preview (object-cover), progress bar overlay (percentage during upload), X button (top-right) for removal
- Use `rounded-md` corners, `ring-1 ring-border` for thumbnail container
- X button: absolute positioned, `h-4 w-4`, uses lucide `X` icon, same ghost hover pattern as icon buttons in ui.md

**Preview Modal**
- Click on a thumbnail opens a fullscreen preview modal
- Use shadcn `Dialog` component for the modal
- Display the image centered with max-width/max-height constraints
- Support zoom: click to toggle between fit-to-screen and 100% natural size
- No additional zoom controls (pinch-to-zoom is browser-native)

**Textarea Height Behavior**
- Default to `rows={3}` (per PASTE-07, changing from current `rows={1}`)
- Max height: 5 rows equivalent, then scrollbar appears
- Use CSS `min-h-[72px]` (3 rows × ~24px) and `max-h-[120px]` (5 rows × ~24px)
- Keep `resize-none` to prevent manual resize

### Claude's Discretion
- Progress bar visual style (thin bar at bottom of thumbnail vs radial)
- Exact animation for upload completion (fade out progress bar)
- Whether to show a subtle "paste image" hint in the input area

### Deferred Ideas (OUT OF SCOPE)
- Drag-and-drop upload (FILE-02) — future milestone
- Non-image file paste support (FILE-01) — future milestone
- Image reordering within thumbnail strip — not in requirements
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PASTE-01 | User pastes image in chat input → uploads and shows 48px thumbnail above input box | `useImageUpload` hook + `ImageThumbnailStrip` component |
| PASTE-02 | Upload shows progress bar with percentage | XHR `upload.onprogress` pattern; progress stored in hook state |
| PASTE-03 | User can click thumbnail to open preview modal (zoom in/out) | shadcn `Dialog` (base-ui) + zoom state toggle in `ImagePreviewModal` |
| PASTE-04 | User can click to remove a single pending image | `removeImage(id)` in hook; aborts XHR, revokes blob URL |
| PASTE-05 | User can paste multiple times to accumulate images | `addImages(files)` appends to array state, strips clears on send |
| PASTE-06 | Paste uses `clipboardData.items` (not `.files`) for Firefox compatibility | `onPaste` handler iterates `e.clipboardData.items` |
| PASTE-07 | Input textarea defaults to 3 rows height, max 5 rows then scrollbar | `rows={3}`, `min-h-[72px]`, `max-h-[120px]` on existing `<Textarea>` |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React (built-in) | 19 | `useState`, `useEffect`, `useRef` for hook | Already in project |
| @base-ui/react/dialog | installed | Preview modal — `Dialog.Root`, `Dialog.Popup`, `Dialog.Backdrop`, `Dialog.Close` | Project's shadcn preset uses base-ui, NOT Radix |
| lucide-react | installed | `X`, `AlertCircle` icons in thumbnail | All icons in project use lucide |
| TailwindCSS 4 | installed | All styling via utility classes | Project standard |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Web API — XMLHttpRequest | browser-native | Upload with progress tracking | Use instead of `fetch` — `fetch` has no progress events |
| Web API — URL.createObjectURL | browser-native | Instant blob preview before upload completes | Always use for in-memory image preview |
| Web API — ClipboardEvent.clipboardData.items | browser-native | Cross-browser paste extraction (Chrome + Firefox) | Use `.items` not `.files` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| XHR for upload | fetch + ReadableStream | fetch lacks `upload.onprogress`; XHR is the correct tool here |
| base-ui Dialog | Radix Dialog | Project uses base-ui/react — Radix API differs; do not swap |
| CSS transition for progress | framer-motion | Unnecessary dependency; CSS `transition-all duration-150` is sufficient |

**Installation:** No new packages needed. All dependencies are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── hooks/
│   └── use-image-upload.ts          # NEW: upload state + XHR management
├── components/assistant/
│   ├── assistant-chat.tsx            # MODIFIED: onPaste, thumbnail strip, updated handleSend
│   ├── assistant-provider.tsx        # MODIFIED: sendChatMessage accepts imageFilenames?
│   ├── image-thumbnail-strip.tsx     # NEW: horizontal thumbnail row
│   └── image-preview-modal.tsx       # NEW: fullscreen zoom modal
└── lib/
    └── i18n.tsx                      # MODIFIED: add 5 new i18n keys
```

### Pattern 1: useImageUpload Hook

**What:** Manages array of `PendingImage` objects; each owns its own XHR instance stored in a ref map keyed by image ID.

**When to use:** Called once in `AssistantChat`, results passed as props to strip and modal components.

```typescript
// src/hooks/use-image-upload.ts
interface PendingImage {
  id: string;
  file: File;
  blobUrl: string;
  status: "uploading" | "done" | "error";
  progress: number;
  filename?: string;  // populated after upload success
}

export function useImageUpload() {
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const xhrMap = useRef<Map<string, XMLHttpRequest>>(new Map());

  const addImages = useCallback((files: File[]) => {
    files.forEach((file) => {
      const id = crypto.randomUUID();
      const blobUrl = URL.createObjectURL(file);
      // Add to state immediately at 0% progress
      setPendingImages((prev) => [
        ...prev,
        { id, file, blobUrl, status: "uploading", progress: 0 },
      ]);
      // Start XHR upload
      const xhr = new XMLHttpRequest();
      xhrMap.current.set(id, xhr);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        setPendingImages((prev) =>
          prev.map((img) => img.id === id ? { ...img, progress: pct } : img)
        );
      };
      xhr.onload = () => {
        xhrMap.current.delete(id);
        if (xhr.status === 200) {
          const { filename } = JSON.parse(xhr.responseText);
          setPendingImages((prev) =>
            prev.map((img) =>
              img.id === id ? { ...img, status: "done", progress: 100, filename } : img
            )
          );
        } else {
          setPendingImages((prev) =>
            prev.map((img) => img.id === id ? { ...img, status: "error" } : img)
          );
        }
      };
      xhr.onerror = () => {
        xhrMap.current.delete(id);
        setPendingImages((prev) =>
          prev.map((img) => img.id === id ? { ...img, status: "error" } : img)
        );
      };
      const formData = new FormData();
      formData.append("file", file);
      xhr.open("POST", "/api/internal/assistant/images");
      xhr.send(formData);
    });
  }, []);

  const removeImage = useCallback((id: string) => {
    const xhr = xhrMap.current.get(id);
    if (xhr) { xhr.abort(); xhrMap.current.delete(id); }
    setPendingImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.blobUrl);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setPendingImages((prev) => {
      prev.forEach((img) => {
        const xhr = xhrMap.current.get(img.id);
        if (xhr) xhr.abort();
        URL.revokeObjectURL(img.blobUrl);
      });
      xhrMap.current.clear();
      return [];
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      setPendingImages((prev) => {
        prev.forEach((img) => {
          const xhr = xhrMap.current.get(img.id);
          if (xhr) xhr.abort();
          URL.revokeObjectURL(img.blobUrl);
        });
        xhrMap.current.clear();
        return [];
      });
    };
  }, []);

  const hasUploading = pendingImages.some((i) => i.status === "uploading");

  return { pendingImages, addImages, removeImage, clearAll, hasUploading };
}
```

### Pattern 2: Paste Handler in AssistantChat

**What:** `onPaste` on `<Textarea>` extracts image items only. Text items fall through to default behavior.

```typescript
const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
  const imageFiles: File[] = [];
  const items = Array.from(e.clipboardData.items);
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) imageFiles.push(file);
    }
  }
  if (imageFiles.length > 0) {
    // Do NOT call e.preventDefault() — text items still need to paste normally
    addImages(imageFiles);
  }
}, [addImages]);
```

### Pattern 3: sendChatMessage Signature Extension

**What:** Add optional second argument to `sendChatMessage` in provider. Backward-compatible.

```typescript
// In AssistantContextValue interface:
sendChatMessage: (text: string, options?: { imageFilenames?: string[] }) => void;

// In provider body, extend the fetch payload:
body: JSON.stringify({
  message: text,
  sessionId: sessionIdRef.current,
  imageFilenames: options?.imageFilenames ?? [],
}),
```

### Pattern 4: Dialog Usage (base-ui API)

**What:** The project's Dialog component wraps `@base-ui/react/dialog`, NOT `@radix-ui/react-dialog`. The API differs from typical shadcn examples.

```typescript
// CORRECT for this project (base-ui):
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";

function ImagePreviewModal({ blobUrl, open, onOpenChange }: Props) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden bg-black/90"
      >
        {/* Custom close button using ghost icon button pattern from ui.md */}
        <DialogClose
          render={
            <Button
              variant="ghost"
              className="absolute top-2 right-2 h-8 w-8 p-0 text-white hover:bg-white/20 hover:text-white"
            />
          }
          aria-label={t("assistant.closePreview")}
        >
          <X className="h-4 w-4" />
        </DialogClose>

        <img
          src={blobUrl}
          alt=""
          onClick={() => setZoomed((z) => !z)}
          className={zoomed
            ? "w-auto h-auto max-w-none object-none cursor-zoom-out overflow-auto"
            : "max-w-full max-h-[85vh] object-contain cursor-zoom-in"
          }
        />
      </DialogContent>
    </Dialog>
  );
}
```

### Pattern 5: handleSend Update

**What:** Collect done filenames before clearing, pass to sendMessage, then clear.

```typescript
const handleSend = () => {
  const text = inputValue.trim();
  const doneFilenames = pendingImages
    .filter((i) => i.status === "done")
    .map((i) => i.filename!);

  if (!text && doneFilenames.length === 0) return;
  if (isThinking || hasUploading) return;

  sendMessage(text, { imageFilenames: doneFilenames });
  setInputValue("");
  clearAll();
  inputRef.current?.focus();
};
```

### Anti-Patterns to Avoid

- **Do not use `clipboardData.files`** — Firefox does not populate `.files` for pasted images; always use `.items`
- **Do not call `e.preventDefault()` unconditionally** — text paste must still work normally
- **Do not use `fetch` for upload** — `fetch` does not expose upload progress; use `XMLHttpRequest`
- **Do not use `@radix-ui/react-dialog` API** — the project uses `@base-ui/react/dialog`; `DialogContent` has `showCloseButton` prop and `DialogClose` uses `render` prop pattern
- **Do not store XHR instances in state** — XHR objects are mutable and not serializable; store in `useRef<Map>`
- **Do not revoke blob URLs before the `<img>` has rendered** — revoke only on explicit removal or unmount

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Upload progress | Custom fetch-based progress polyfill | `XMLHttpRequest` with `upload.onprogress` | XHR is the only browser API with native upload progress |
| Image preview modal | Custom modal from scratch | Existing `src/components/ui/dialog.tsx` | Already installed and styled; handles focus trap, backdrop, Escape key |
| Blob URL lifecycle | Manual GC tracking | `URL.createObjectURL` + `URL.revokeObjectURL` | Browser provides this pair; cleanup in `removeImage` and `useEffect` return |
| Icon buttons | Custom button | Existing Button ghost pattern from `ui.md` | Consistent hover state required by ui.md rules |

**Key insight:** Every building block is already available. This phase is entirely about composition, not new infrastructure.

---

## Common Pitfalls

### Pitfall 1: Dialog `render` Prop Pattern (base-ui specific)

**What goes wrong:** Using `<DialogClose asChild>` (Radix pattern) — base-ui does not have `asChild`. The close button renders incorrectly or throws.

**Why it happens:** Training data and most shadcn docs describe Radix-based Dialog. This project uses `@base-ui/react/dialog` (`base-nova` preset).

**How to avoid:** Use `DialogClose render={<Button ... />}` pattern as shown in `src/components/ui/dialog.tsx` line 63-77.

**Warning signs:** `asChild` prop is silently ignored, button renders as a `<button>` inside another `<button>`.

### Pitfall 2: XHR Response Parsing Timing

**What goes wrong:** Reading `xhr.responseText` inside `xhr.upload.onload` (upload progress complete) instead of `xhr.onload` (full response received). Results in empty response text.

**Why it happens:** `xhr.upload` events fire when the request body finishes sending, NOT when the server response arrives.

**How to avoid:** Always parse `xhr.responseText` in `xhr.onload` (the outer XHR, not `xhr.upload`).

### Pitfall 3: setState Inside useEffect Return Causes Warning

**What goes wrong:** Calling `setPendingImages(...)` inside the `useEffect` cleanup function after component unmounts triggers a "Can't perform a React state update on an unmounted component" warning (and in React 19 may be silently swallowed).

**How to avoid:** In the unmount cleanup, use the `xhrMap.current` ref directly (no state update needed — component is unmounting). Only abort XHRs and revoke blob URLs; do not update state.

```typescript
// CORRECT cleanup pattern:
useEffect(() => {
  return () => {
    pendingImages.forEach((img) => URL.revokeObjectURL(img.blobUrl));
    xhrMap.current.forEach((xhr) => xhr.abort());
    xhrMap.current.clear();
  };
}, []); // empty deps — capture via ref, not closure
```

Note: `pendingImages` is not a dep here intentionally. Store images in a ref (`imagesRef`) that mirrors state if cleanup must be dep-free. See Code Examples below.

### Pitfall 4: isSendDisabled Logic Must Handle Image-Only Messages

**What goes wrong:** `isSendDisabled = !inputValue.trim() || isThinking` — this blocks sending when user has pasted images but typed no text.

**How to avoid:**
```typescript
const isSendDisabled =
  (inputValue.trim() === "" && pendingImages.filter(i => i.status === "done").length === 0)
  || isThinking
  || hasUploading;
```

### Pitfall 5: Thumbnail Click Opens Modal While Uploading

**What goes wrong:** Clicking a thumbnail during upload opens the preview modal, but the image may not yet be meaningful to preview.

**How to avoid:** Only trigger modal open when `status === "done"`. During "uploading" or "error", ignore click or show a cursor indicating no action.

---

## Code Examples

### Existing Dialog component close pattern (from `src/components/ui/dialog.tsx`)

```typescript
// Source: src/components/ui/dialog.tsx lines 62-77
<DialogPrimitive.Close
  data-slot="dialog-close"
  render={
    <Button
      variant="ghost"
      className="absolute top-2 right-2"
      size="icon-sm"
    />
  }
>
  <XIcon />
  <span className="sr-only">Close</span>
</DialogPrimitive.Close>
```

### Existing ghost icon button pattern (from `ui.md`)

```typescript
// Source: .claude/rules/ui.md
<Button
  variant="ghost"
  className="h-8 w-8 p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
>
  <Icon className="h-4 w-4" />
</Button>
```

### XHR upload with progress (Web API standard)

```typescript
// Source: MDN XMLHttpRequest.upload
const xhr = new XMLHttpRequest();
xhr.upload.onprogress = (e) => {
  if (e.lengthComputable) {
    const percent = Math.round((e.loaded / e.total) * 100);
    // update state here
  }
};
xhr.onload = () => {
  if (xhr.status === 200) {
    const data = JSON.parse(xhr.responseText); // { filename, mimeType }
  }
};
const formData = new FormData();
formData.append("file", file);
xhr.open("POST", "/api/internal/assistant/images");
xhr.send(formData);
```

### Thumbnail strip progress bar HTML (from UI-SPEC.md)

```typescript
// Source: 41-UI-SPEC.md component inventory
<div className="relative h-12 w-12 shrink-0 rounded-md overflow-hidden ring-1 ring-border">
  <img src={blobUrl} className="h-full w-full object-cover" alt="" aria-hidden="true" />
  {status === "uploading" && (
    <div className="absolute inset-0 flex flex-col justify-end bg-black/30">
      <div className="h-1 bg-primary transition-all duration-150"
           style={{ width: `${progress}%` }} />
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white">
        {progress}%
      </span>
    </div>
  )}
  <button
    className="absolute top-1 right-1 h-4 w-4 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
    aria-label={t("assistant.removeImage")}
    onClick={() => removeImage(id)}
  >
    <X className="h-2.5 w-2.5" />
  </button>
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `rows={1}` + `min-h-[40px]` | `rows={3}` + `min-h-[72px]` | Phase 41 | Textarea taller by default |
| `sendChatMessage(text: string)` | `sendChatMessage(text, options?)` | Phase 41 | Backward-compatible extension |

**Deprecated/outdated:**
- `clipboardData.files` for paste handling: Does not work in Firefox for clipboard items — replaced by `clipboardData.items`.

---

## Open Questions

1. **Message payload shape for image filenames**
   - What we know: `sendChatMessage` currently sends `{ message: text, sessionId }` to the chat API
   - What's unclear: Phase 43 (AI integration) will consume filenames — Phase 41 should store them in the message payload, but the exact field name in the API body is not yet defined
   - Recommendation: Add `imageFilenames: string[]` to the POST body in Phase 41 (even if the chat API ignores it for now); Phase 43 will read the field. Document this forward-compatibility choice.

2. **imagesRef mirroring for cleanup**
   - What we know: Using a `useEffect` return for blob URL cleanup with empty deps causes a stale closure if implemented naively
   - What's unclear: Whether to mirror `pendingImages` in a `useRef` for the cleanup function
   - Recommendation: Mirror with `useRef<PendingImage[]>` that is kept in sync via a `useEffect` — this is the standard pattern for stable cleanup closures.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all required browser APIs, components, and the Phase 40 upload endpoint are already available).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 + jsdom + @testing-library/react |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run --reporter=verbose src/hooks/__tests__/` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PASTE-01 | `addImages()` creates blob URL, sets status "uploading" at 0% | unit | `pnpm test:run src/hooks/__tests__/use-image-upload.test.ts -t "addImages"` | ❌ Wave 0 |
| PASTE-02 | XHR `upload.onprogress` updates progress in state | unit | `pnpm test:run src/hooks/__tests__/use-image-upload.test.ts -t "progress"` | ❌ Wave 0 |
| PASTE-03 | Thumbnail click sets modal open state | unit | `pnpm test:run src/components/assistant/__tests__/image-thumbnail-strip.test.tsx` | ❌ Wave 0 |
| PASTE-04 | `removeImage()` aborts XHR, revokes blob URL, removes from state | unit | `pnpm test:run src/hooks/__tests__/use-image-upload.test.ts -t "removeImage"` | ❌ Wave 0 |
| PASTE-05 | Multiple `addImages()` calls accumulate in array | unit | `pnpm test:run src/hooks/__tests__/use-image-upload.test.ts -t "accumulate"` | ❌ Wave 0 |
| PASTE-06 | Paste handler reads `clipboardData.items`, skips non-image items | unit | `pnpm test:run src/components/assistant/__tests__/assistant-chat.test.tsx -t "paste"` | ❌ Wave 0 |
| PASTE-07 | Textarea has `rows={3}` and correct min/max height classes | unit | `pnpm test:run src/components/assistant/__tests__/assistant-chat.test.tsx -t "textarea rows"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run src/hooks/__tests__/use-image-upload.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/hooks/__tests__/use-image-upload.test.ts` — covers PASTE-01, PASTE-02, PASTE-04, PASTE-05
- [ ] `src/components/assistant/__tests__/image-thumbnail-strip.test.tsx` — covers PASTE-03
- [ ] `src/components/assistant/__tests__/assistant-chat.test.tsx` — covers PASTE-06, PASTE-07 (may already exist partially)

---

## Project Constraints (from CLAUDE.md)

Directives the planner MUST verify compliance with:

| Directive | Impact on Phase 41 |
|-----------|-------------------|
| All user-visible text uses `t("key")` from `useI18n()` | 5 new i18n keys required: `assistant.removeImage`, `assistant.uploadFailed`, `assistant.uploadFailedRemoveHint`, `assistant.closePreview`, `assistant.inputPlaceholderWithImages` — add to both zh and en in `i18n.tsx` |
| Next.js 15+ async params: `const { id } = await params` | Not applicable (no route params in this phase) |
| App Router routes: `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"` | Not applicable (no new API routes in this phase) |
| UI: Never use `<SelectValue />` — use manual `<span>` | Not applicable (no Select components) |
| UI: Toasts via Sonner `toast.error("msg")` | Upload errors do NOT use toasts per UI-SPEC — thumbnail ring + tooltip only. No toast needed. |
| UI: Ghost icon buttons use `h-8 w-8 p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground` | X remove button on thumbnail is 16px (`h-4 w-4`) — this is an exception due to 48px container constraint. The preview modal close button DOES use the standard `h-8 w-8` pattern. |
| pnpm preferred over npm | Use `pnpm test:run` for all test commands |
| No `console.log` in production code | `useImageUpload` hook must not log errors — set state to `"error"` instead |
| Security: Internal API routes must call `requireLocalhost` | Not applicable — this is client-side code calling an existing route |
| Immutability: Always create new objects, never mutate | All state updates in `useImageUpload` use spread/map/filter — no in-place mutation |

---

## Sources

### Primary (HIGH confidence)

- Codebase: `src/components/ui/dialog.tsx` — verified base-ui Dialog API with `render` prop pattern
- Codebase: `src/components/assistant/assistant-chat.tsx` — verified current textarea `rows={1}`, `min-h-[40px]`, `handleSend` signature
- Codebase: `src/components/assistant/assistant-provider.tsx` — verified `sendChatMessage(text: string)` signature
- Codebase: `src/app/api/internal/assistant/images/route.ts` — verified Phase 40 API returns `{ filename, mimeType }`
- Codebase: `src/lib/i18n.tsx` — verified existing `assistant.*` keys to avoid conflicts
- Codebase: `vitest.config.ts` — confirmed jsdom environment, test include globs
- Codebase: `.claude/rules/ui.md` — ghost button sizing rules and patterns

### Secondary (MEDIUM confidence)

- MDN ClipboardEvent.clipboardData — `items` vs `files` Firefox behavior (widely documented)
- MDN XMLHttpRequest.upload.onprogress — standard API for upload progress

### Tertiary (LOW confidence)

- None.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components verified in codebase
- Architecture: HIGH — hook patterns, Dialog API, and paste handler all verified against actual source files
- Pitfalls: HIGH — base-ui Dialog vs Radix is a concrete code difference verified in `dialog.tsx`; XHR vs fetch is a well-known browser API constraint

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (stable APIs — Dialog component, browser clipboard API)
