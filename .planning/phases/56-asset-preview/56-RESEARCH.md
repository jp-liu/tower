# Phase 56: Asset Preview - Research

**Researched:** 2026-04-20
**Domain:** Frontend UI components (image lightbox, text preview, system integration)
**Confidence:** HIGH

## Summary

Phase 56 adds in-browser asset inspection to the existing assets page. The scope is well-defined: (1) enhance the existing `ImagePreviewModal` for fullscreen image lightbox with zoom/pan, (2) create a new `TextPreviewDialog` for .txt/.md/.json files, (3) add a "reveal in Finder" API endpoint that shells out to `open -R`, and (4) reorganize the `AssetItem` action buttons to [Preview] [Reveal in Finder] [Delete].

All required libraries are already in the project (`react-markdown`, `remark-gfm`, shadcn Dialog via `@base-ui/react`). No new dependencies are needed. The existing codebase has clear patterns for Markdown rendering (used in `assistant-chat-bubble.tsx`, `note-card.tsx`), Dialog modals, internal API routes with localhost guards, and i18n. This phase is purely additive UI work with one small server-side API route.

**Primary recommendation:** Reuse `ImagePreviewModal` with pan support added, create `TextPreviewDialog` as a new component, add `/api/internal/assets/reveal` route, and modify `AssetItem` to wire the three action buttons.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ASSET-01 | Clicking image asset opens fullscreen lightbox with zoom/pan and Escape to close | Existing `ImagePreviewModal` has zoom toggle and Dialog with Escape support; needs pan (CSS overflow + drag or scroll) |
| ASSET-02 | Clicking text/md/json asset opens preview dialog with markdown rendering or monospace display | `react-markdown` + `remark-gfm` already installed; pattern in `note-card.tsx` and `assistant-chat-bubble.tsx` |
| ASSET-03 | "Reveal in Finder" button opens containing folder in system file manager | New `/api/internal/assets/reveal` route using `child_process.execFile("open", ["-R", path])` on macOS |
| ASSET-04 | Asset action buttons reorganized to: [Preview] [Reveal in Finder] [Delete] | Modify `AssetItem` component — replace Download `<a>` with Preview button + Reveal button |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack:** Next.js 16 / TypeScript / SQLite (Prisma) / TailwindCSS 4 / shadcn (base-nova)
- **i18n:** All user-facing text must use `t("key")` — zh/en bilingual
- **Next.js async params:** `const { id } = await params`
- **App Router routes:** `export const runtime = "nodejs"` + `export const dynamic = "force-dynamic"`
- **UI rules:** Default button size (h-8), icon buttons use `hover:bg-accent hover:text-foreground transition-colors`, Sonner for toast, no layout shift loading
- **Security:** Internal API routes must call `requireLocalhost(request)`, validate inputs, no shell metacharacters
- **Package manager:** pnpm

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-markdown | ^10.1.0 | Markdown rendering for .md preview | Already used in chat bubbles and note cards |
| remark-gfm | ^4.0.1 | GitHub Flavored Markdown tables/strikethrough | Already paired with react-markdown |
| @base-ui/react Dialog | (bundled) | Modal dialogs | Project's shadcn variant uses base-ui |
| lucide-react | (installed) | Icon set | Project standard |

### Supporting (already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next/server | 16.x | API route handlers | Reveal endpoint |
| node:child_process | built-in | Shell out to `open -R` | Reveal in Finder |

### No New Dependencies Required

All functionality can be built with existing project dependencies. No `npm install` needed.

## Architecture Patterns

### New Files to Create
```
src/
├── components/assets/
│   ├── image-lightbox.tsx       # Fullscreen image viewer (evolved from ImagePreviewModal)
│   └── text-preview-dialog.tsx  # .txt/.md/.json preview dialog
├── app/api/internal/assets/
│   └── reveal/route.ts          # POST — opens file in system file manager
```

### Modified Files
```
src/
├── components/assets/
│   ├── asset-item.tsx           # Replace Download with Preview + Reveal buttons
│   └── asset-list.tsx           # Pass preview/reveal handlers down
├── app/workspaces/[workspaceId]/assets/
│   └── assets-page-client.tsx   # State management for preview modals
├── lib/i18n/
│   ├── zh.ts                    # New i18n keys
│   └── en.ts                    # New i18n keys
```

### Pattern 1: Image Lightbox with Zoom/Pan
**What:** Enhance `ImagePreviewModal` or create a new `ImageLightbox` component with zoom levels and pan (drag or scroll overflow).
**When to use:** Clicking any image asset.
**Approach:**
```typescript
// Two zoom states: fit-to-screen (default) and full-size (scrollable)
// Pan = native CSS overflow:auto when zoomed in
// Click image to toggle zoom, Escape to close (Dialog handles this)
const [zoomed, setZoomed] = useState(false);

// When zoomed: container has overflow-auto, image is natural size
// When not zoomed: image constrained by max-w-full max-h-[85vh]
<div className={zoomed ? "overflow-auto max-w-[90vw] max-h-[90vh]" : ""}>
  <img
    onClick={() => setZoomed(z => !z)}
    className={zoomed
      ? "w-auto h-auto max-w-none cursor-zoom-out"
      : "max-w-full max-h-[85vh] object-contain cursor-zoom-in mx-auto"
    }
  />
</div>
```

**Key insight:** The existing `ImagePreviewModal` already has zoom toggle and Dialog-based close. The main addition is making the zoomed container scrollable so the user can pan. No need for a complex drag-to-pan library — CSS `overflow: auto` with scroll achieves pan naturally.

### Pattern 2: Text Preview Dialog
**What:** Dialog that fetches file content from the existing file-serve API, renders .md as Markdown and .txt/.json as monospace.
**When to use:** Clicking a .txt, .md, or .json asset.
**Approach:**
```typescript
// Fetch content from existing API URL
const [content, setContent] = useState<string | null>(null);
useEffect(() => {
  if (!open || !url) return;
  fetch(url).then(r => r.text()).then(setContent);
}, [open, url]);

// Render based on file extension
const ext = filename.split('.').pop()?.toLowerCase();
if (ext === 'md') {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
} else {
  return <pre className="font-mono text-sm whitespace-pre-wrap">{content}</pre>;
}
```

### Pattern 3: Reveal in Finder API Route
**What:** Internal POST endpoint that runs `open -R <filepath>` to highlight the file in macOS Finder.
**When to use:** User clicks "Reveal in Finder" button.
**Approach:**
```typescript
// POST /api/internal/assets/reveal
// Body: { path: "data/assets/{projectId}/{filename}" }
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Validate path resolves within data/assets/ (reuse resolveAssetPath)
// Then: await execFileAsync("open", ["-R", resolvedPath]);
```

### Anti-Patterns to Avoid
- **Don't use `exec()` for shell commands:** Use `execFile()` which does NOT invoke a shell, preventing command injection. The `open` command with `-R` flag and a validated file path is safe with `execFile`.
- **Don't fetch file content server-side for preview:** The existing `/api/files/assets/[projectId]/[filename]` route already serves files. Fetch from the client using that URL.
- **Don't create a new image preview modal from scratch:** The existing `ImagePreviewModal` pattern is proven; extend it rather than replacing it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom parser | `react-markdown` + `remark-gfm` | Already in project, handles edge cases |
| Modal/Dialog | Custom overlay | shadcn `Dialog` (base-ui) | Handles focus trap, Escape, backdrop click, aria |
| File serving | New endpoint | Existing `/api/files/assets/` route | Already handles MIME types, path validation, security |
| Zoom/Pan gesture lib | Complex drag handler | CSS `overflow: auto` on zoomed container | Scroll-to-pan is native, no library needed |

## Common Pitfalls

### Pitfall 1: Command Injection via Reveal Path
**What goes wrong:** Using `exec("open -R " + path)` allows shell injection.
**Why it happens:** String concatenation in shell commands.
**How to avoid:** Use `execFile("open", ["-R", resolvedPath])` — no shell invoked. Validate path with `resolveAssetPath()` first to ensure it stays within `data/assets/`.
**Warning signs:** Using `exec()` instead of `execFile()`, or not validating the path.

### Pitfall 2: Dialog State Management Complexity
**What goes wrong:** Multiple preview dialogs (image + text) with shared state becomes tangled.
**Why it happens:** Trying to manage both modals at the page level with many state variables.
**How to avoid:** Use a single `previewAsset` state that holds the asset being previewed (or null). Determine which dialog to show based on the asset's mimeType. Only one dialog open at a time.
**Warning signs:** Multiple boolean `open` states, race conditions on quick clicks.

### Pitfall 3: Fetching Text Content Without Error Handling
**What goes wrong:** Text preview shows blank or crashes on network error.
**Why it happens:** Not handling fetch failures or large files.
**How to avoid:** Show loading state while fetching, error state on failure. Consider truncating very large files (>1MB) with a "file too large for preview" message.
**Warning signs:** No loading indicator, no error state in text preview.

### Pitfall 4: Missing i18n Keys
**What goes wrong:** Raw key strings appear in the UI.
**Why it happens:** Adding new buttons without updating both zh.ts and en.ts.
**How to avoid:** Add all new keys to BOTH language files before implementing the component. Required new keys:
- `assets.revealInFinder` / "Reveal in Finder" / "在文件夹中显示"
- `assets.previewNotSupported` / "Preview not supported" / "不支持预览"
- `assets.loadingPreview` / "Loading..." / "加载中..."
- `assets.previewError` / "Failed to load preview" / "加载预览失败"

### Pitfall 5: macOS-Only `open -R`
**What goes wrong:** Reveal in Finder fails on non-macOS systems.
**Why it happens:** `open -R` is macOS-specific.
**How to avoid:** This is a local-only tool and CLAUDE.md doesn't mention cross-platform. The CONTEXT.md specifies `open -R` on macOS. For robustness, detect platform: macOS = `open -R`, Linux = `xdg-open` (parent dir), Windows = `explorer /select,`. But given this is a macOS-first local tool, starting with `open -R` and adding others later is acceptable.
**Warning signs:** Hard failure with no error message on Linux.

## Code Examples

### Existing Markdown Rendering Pattern (from note-card.tsx)
```typescript
// Source: src/components/notes/note-card.tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

<ReactMarkdown remarkPlugins={[remarkGfm]}>
  {content}
</ReactMarkdown>
```

### Existing Dialog Pattern (from image-preview-modal.tsx)
```typescript
// Source: src/components/assistant/image-preview-modal.tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent showCloseButton={false} className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden bg-black/90 ring-0">
    <DialogClose render={<Button variant="ghost" className="absolute top-2 right-2 z-10 ..." />}>
      <X className="h-4 w-4" />
    </DialogClose>
    {/* content */}
  </DialogContent>
</Dialog>
```

### Existing Internal API Route Pattern (from assets route)
```typescript
// Source: src/app/api/internal/assets/[projectId]/[filename]/route.ts
import { requireLocalhost } from "@/lib/internal-api-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;
  // ... validate inputs, execute action
}
```

### Icon Button Pattern (from UI rules)
```typescript
// Source: .claude/rules/ui.md
<button
  className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
  aria-label={t("assets.revealInFinder")}
>
  <FolderOpen className="h-4 w-4" />
</button>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Download-only for assets | In-browser preview | This phase | Users inspect assets without leaving the browser |
| No system integration | Reveal in Finder | This phase | Bridge between web UI and local filesystem |

## Open Questions

1. **Large file handling for text preview**
   - What we know: Text files can be arbitrarily large
   - What's unclear: What size threshold should trigger "file too large" message
   - Recommendation: Cap at 1MB for text preview; show first 1MB with a truncation notice

2. **Cross-platform reveal command**
   - What we know: macOS uses `open -R`, Linux uses `xdg-open`, Windows uses `explorer /select,`
   - What's unclear: Whether to support all platforms now
   - Recommendation: Implement macOS `open -R` as primary. Add `process.platform` switch for Linux/Windows as a defensive measure, since it's trivial.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `open` command | Reveal in Finder | Yes (macOS built-in) | — | Platform detection for Linux/Windows |
| react-markdown | .md preview | Yes (installed) | ^10.1.0 | — |
| remark-gfm | GFM tables in .md | Yes (installed) | ^4.0.1 | — |

**Missing dependencies with no fallback:** None
**Missing dependencies with fallback:** None

## Sources

### Primary (HIGH confidence)
- Project source code: `src/components/assistant/image-preview-modal.tsx` — existing zoom dialog pattern
- Project source code: `src/components/assets/asset-item.tsx` — current action button layout
- Project source code: `src/components/notes/note-card.tsx` — ReactMarkdown usage pattern
- Project source code: `src/lib/internal-api-guard.ts` — localhost guard for internal routes
- Project source code: `src/lib/file-serve.ts` — path resolution and MIME type mapping
- Project source code: `prisma/schema.prisma` — ProjectAsset model with mimeType, path, filename

### Secondary (MEDIUM confidence)
- macOS `open -R` command — standard macOS system utility for revealing files in Finder

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and used in project
- Architecture: HIGH — clear patterns from existing code, well-defined scope
- Pitfalls: HIGH — common web security and UX patterns, verified against project conventions

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable scope, no external dependency changes expected)
