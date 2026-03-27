# Phase 7: Notes & Assets Web UI - Research

**Researched:** 2026-03-27
**Domain:** Next.js 16 React 19 UI — Markdown editor, file list, i18n, server actions
**Confidence:** HIGH

## Summary

Phase 7 adds two project-scoped pages to the existing Kanban workspace: a Notes page (list + Markdown editor + category filter) and an Assets page (file list + preview). All backing data actions already exist from Phase 4 (`note-actions.ts`, `asset-actions.ts`). The file serving API from Phase 6 (`/api/files/assets/[projectId]/[filename]`) handles asset URLs.

The primary open risk is `@uiw/react-md-editor` hydration in Next.js 16 with React 19. The editor is not currently installed. The project already has `react-markdown@10.1.0` and `@tailwindcss/typography` installed, which together provide a known-working fallback. The plan MUST test the `@uiw` dynamic-import path first; if hydration errors appear, fall back to `<textarea>` input + `<ReactMarkdown>` preview.

UI navigation: the existing board page uses `ProjectTabs` for project selection. Notes and Assets should be separate sub-routes (e.g. `/workspaces/[workspaceId]/notes?projectId=...` and `/workspaces/[workspaceId]/assets?projectId=...`) following the same Server Component + Client Component split already established. Alternatively, they can appear as view-mode tabs inside the existing board page client. Based on the existing archive page pattern (`/workspaces/[workspaceId]/archive`), a separate route is the lower-risk approach — it avoids bloating `board-page-client.tsx`.

**Primary recommendation:** Add `/notes` and `/assets` sub-routes under the workspace, each following the same Server Component (data fetch) + Client Component (interactivity) pattern as the existing board and archive pages.

<user_constraints>
## User Constraints (from STATE.md Accumulated Context)

### Locked Decisions
- @uiw/react-md-editor requires dynamic import with ssr:false — test this first in Phase 7; fall back to textarea + react-markdown if hydration errors occur
- All UI strings must support zh/en via existing i18n system (`src/lib/i18n.tsx` — add keys to both `zh` and `en` sections of `translations`)
- FTS5 virtual tables must be created via raw SQL AFTER prisma db push — never before
- Both PrismaClient instances need PRAGMA busy_timeout=5000
- file-utils.ts and fts.ts must never import Next.js modules
- Next.js 16 params/searchParams are Promises — always await them

### Claude's Discretion
- Page navigation structure: separate routes vs. tabs within board page (research recommends separate routes, matching archive page pattern)
- Number of plans for Phase 7 (TBD in ROADMAP.md)
- Whether to add upload capability to Assets page (UI-02 says "file list, preview, upload" — upload requires file input + server action to move files)

### Deferred Ideas (OUT OF SCOPE)
- SRCH-01: Cross-project global note search
- SRCH-02: Note tag system
- COLLAB-01: Note version history and rollback
- COLLAB-02: Note templates
- Nested note folders
- Auto cache cleanup
- base64 image upload
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Project notes page: list, Markdown editor, category filter | `getProjectNotes(projectId, {category?})` and `createNote`/`updateNote`/`deleteNote` from `src/actions/note-actions.ts` already exist. `NOTE_CATEGORIES_PRESET` in `src/lib/constants.ts`. Markdown editor: `@uiw/react-md-editor` (with dynamic import) or fallback textarea+`react-markdown`. |
| UI-02 | Project assets page: file list, preview, upload | `getProjectAssets(projectId)` and `createAsset`/`deleteAsset` from `src/actions/asset-actions.ts` already exist. File URLs via `localPathToApiUrl` from `src/lib/file-serve.ts`. Upload requires `<input type="file">` + server action or API route to move files into `data/assets/{projectId}/`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-markdown | 10.1.0 (already installed) | Render Markdown as HTML | Already used in task-conversation.tsx; works with React 19, no SSR issues |
| @tailwindcss/typography | 0.5.19 (already installed) | Prose styling for rendered Markdown | Already in package.json |
| remark-gfm | 4.0.1 (already installed) | GitHub-flavored Markdown support | Already used in task-conversation.tsx |
| @uiw/react-md-editor | 4.0.11 (not installed) | Split-pane Markdown editor | Primary candidate per STATE.md decision; must be tested with dynamic import ssr:false |
| lucide-react | 1.6.0 (already installed) | Icons for file type, edit, delete, upload | Already used throughout project |
| @base-ui/react Tabs | already via tabs.tsx | Tab navigation within pages | Already wrapped in `src/components/ui/tabs.tsx` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| next/dynamic | built-in | Dynamic import with ssr:false for @uiw/react-md-editor | Required to prevent hydration errors with the editor |
| useTransition | React 19 built-in | Non-blocking UI during server action calls | Pattern already used in board-page-client.tsx |
| useRouter + router.refresh() | Next.js 16 built-in | Re-fetch server component data after mutations | Pattern already used in board-page-client.tsx |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @uiw/react-md-editor | textarea + react-markdown | textarea is simpler, no SSR risk, already installed; loses live split-pane preview but is a confirmed fallback per STATE.md |
| Separate route pages | Tab panels inside board-page-client | Tabs bloat an already large client component; separate routes match archive page pattern |
| API route for upload | Server action with FormData | Next.js 16 server actions support FormData; avoids extra API route; simpler code path |

**Installation (if @uiw editor passes hydration test):**
```bash
pnpm add @uiw/react-md-editor
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   └── workspaces/[workspaceId]/
│       ├── notes/
│       │   ├── page.tsx              # Server Component: fetch notes + project list
│       │   └── notes-page-client.tsx # Client Component: all interactivity
│       └── assets/
│           ├── page.tsx              # Server Component: fetch assets + project list
│           └── assets-page-client.tsx # Client Component: all interactivity
├── components/
│   ├── notes/
│   │   ├── note-list.tsx             # List with category filter
│   │   ├── note-editor.tsx           # Markdown editor (wraps @uiw or textarea+preview)
│   │   └── note-card.tsx             # Single note row/card
│   └── assets/
│       ├── asset-list.tsx            # File list with icons
│       ├── asset-preview.tsx         # Inline image or file download link
│       └── asset-upload.tsx          # File upload button
```

### Pattern 1: Server Component + Client Component Split (matches existing pages)
**What:** Server Component fetches data, passes as props to Client Component which owns all state
**When to use:** Every new page — this is the established pattern in this codebase
**Example:**
```typescript
// src/app/workspaces/[workspaceId]/notes/page.tsx
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectNotes } from "@/actions/note-actions";
import { NotesPageClient } from "./notes-page-client";

interface Props {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ projectId?: string }>;
}

export default async function NotesPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;           // MUST await in Next.js 16
  const { projectId } = await searchParams;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: { projects: { select: { id: true, name: true, alias: true } } },
  });
  if (!workspace) notFound();

  const project = workspace.projects.find((p) => p.id === projectId) ?? workspace.projects[0];
  const notes = project ? await getProjectNotes(project.id) : [];

  return (
    <NotesPageClient
      workspaceId={workspaceId}
      project={project}
      projects={workspace.projects}
      initialNotes={notes}
    />
  );
}
```

### Pattern 2: Dynamic Import for @uiw/react-md-editor
**What:** Use next/dynamic with ssr:false to avoid hydration mismatch
**When to use:** Any component that uses browser-only APIs (CodeMirror underneath @uiw/react-md-editor)
**Example:**
```typescript
// src/components/notes/note-editor.tsx
"use client";
import dynamic from "next/dynamic";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

interface NoteEditorProps {
  value: string;
  onChange: (val: string) => void;
}

export function NoteEditor({ value, onChange }: NoteEditorProps) {
  return (
    <MDEditor
      value={value}
      onChange={(v) => onChange(v ?? "")}
      height={400}
    />
  );
}
```

**Fallback if hydration errors occur:**
```typescript
// textarea + react-markdown side-by-side
"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Textarea } from "@/components/ui/textarea";

export function NoteEditor({ value, onChange }: NoteEditorProps) {
  return (
    <div className="grid grid-cols-2 gap-4 h-96">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full resize-none font-mono text-sm"
      />
      <div className="prose prose-sm dark:prose-invert overflow-y-auto border rounded-md p-3">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
      </div>
    </div>
  );
}
```

### Pattern 3: i18n String Addition
**What:** Add keys to BOTH `zh` and `en` sections of the `translations` object in `src/lib/i18n.tsx`
**When to use:** Every visible UI string in new components
**Example:**
```typescript
// In src/lib/i18n.tsx, zh section:
"notes.title": "笔记",
"notes.newNote": "新建笔记",
"notes.allCategories": "全部分类",
"notes.category.account": "账号",
"notes.category.env": "环境",
"notes.category.requirements": "需求",
"notes.category.memo": "备忘",
"notes.edit": "编辑",
"notes.delete": "删除",
"notes.save": "保存",
"notes.titlePlaceholder": "笔记标题",
"notes.contentPlaceholder": "笔记内容（支持 Markdown）",
"notes.empty": "暂无笔记",
"notes.emptyHint": "点击「新建笔记」创建第一条笔记",
"notes.deleteConfirm": "确认删除笔记「{title}」？",
"assets.title": "资源",
"assets.upload": "上传文件",
"assets.empty": "暂无资源",
"assets.emptyHint": "上传文件作为项目资源",
"assets.filename": "文件名",
"assets.size": "大小",
"assets.uploadedAt": "上传时间",
"assets.preview": "预览",
"assets.download": "下载",
"assets.delete": "删除",

// SAME keys in en section:
"notes.title": "Notes",
"notes.newNote": "New Note",
// ... etc
```

### Pattern 4: Server Action with useTransition + router.refresh()
**What:** Call server action, then refresh server component data, using startTransition to avoid blocking UI
**When to use:** Any mutation (create/update/delete) that should update the list
**Example:**
```typescript
const router = useRouter();
const [isPending, startTransition] = useTransition();

const handleCreate = async (data: NoteFormData) => {
  await createNote({ ...data, projectId });
  startTransition(() => { router.refresh(); });
};
```

### Pattern 5: Asset Upload via FormData Server Action
**What:** File input → FormData → server action reads file buffer → writes to data/assets/{projectId}/ → createAsset records it
**When to use:** UI-02 asset upload requirement
**Example:**
```typescript
// Server action (note: "use server" + FormData parameter)
export async function uploadAsset(formData: FormData) {
  const file = formData.get("file") as File;
  const projectId = formData.get("projectId") as string;
  const buffer = Buffer.from(await file.arrayBuffer());
  ensureAssetsDir(projectId);
  const dest = path.join(getAssetsDir(projectId), file.name);
  await fs.promises.writeFile(dest, buffer);
  return createAsset({
    filename: file.name,
    path: dest,
    mimeType: file.type || undefined,
    size: file.size,
    projectId,
  });
}
```

### Anti-Patterns to Avoid
- **Importing `next/cache` or any Next.js module in `file-utils.ts` or `fts.ts`:** These are shared with MCP stdio — will break MCP
- **Forgetting to await params/searchParams:** Next.js 16 makes these Promises; will get runtime errors if accessed directly
- **Using SSR with @uiw/react-md-editor:** Must use `dynamic(..., { ssr: false })`; otherwise CodeMirror crashes during hydration
- **Mutating translation object at runtime:** `translations` is `as const` — add new keys at file level only

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom HTML parser | `react-markdown` + `remark-gfm` (already installed) | Handles XSS, edge cases, GFM tables |
| Markdown editing | Custom textarea with preview | `@uiw/react-md-editor` (or fallback textarea+react-markdown) | Already decided; split-pane editor with syntax highlighting |
| File type icons | Custom SVG set | `lucide-react` (already installed) | `FileText`, `Image`, `File`, `FileCode` etc. cover common types |
| Category filter | Custom multi-select | Simple button group (like BoardFilters pattern) | Category count is small (4 preset + custom); full select component is overkill |
| Asset URL building | Manual string concat | `localPathToApiUrl` from `src/lib/file-serve.ts` | Already built and tested in Phase 6 |

**Key insight:** The data layer (actions, FTS, file serving) is fully complete. Phase 7 is purely a UI assembly task — assemble existing pieces into pages.

## Common Pitfalls

### Pitfall 1: @uiw/react-md-editor Hydration Error
**What goes wrong:** `window is not defined` or React hydration mismatch crash on page load
**Why it happens:** @uiw/react-md-editor uses CodeMirror which accesses browser APIs at import time; SSR cannot render it
**How to avoid:** Always import via `next/dynamic(() => import("@uiw/react-md-editor"), { ssr: false })`; never import at top of file
**Warning signs:** "ReferenceError: window is not defined" in server logs; white screen on first load

### Pitfall 2: Next.js 16 params/searchParams not awaited
**What goes wrong:** `TypeError: params.workspaceId is undefined` or similar
**Why it happens:** Next.js 16 changed params and searchParams to be Promises (breaking change from Next.js 14/15)
**How to avoid:** Always `const { workspaceId } = await params;` at the top of every Server Component
**Warning signs:** Undefined values from what looks like a correctly-typed route

### Pitfall 3: Stale data after mutations (router.refresh() omitted)
**What goes wrong:** Note created/deleted but list doesn't update without page reload
**Why it happens:** Server Component data is cached; must explicitly invalidate
**How to avoid:** Call `router.refresh()` inside `startTransition` after every mutating server action; `revalidatePath` in server actions also helps but is not sufficient alone for same-tab updates
**Warning signs:** List shows old data after create/delete

### Pitfall 4: i18n key missing in one locale
**What goes wrong:** UI shows raw key string like `"notes.newNote"` in English mode
**Why it happens:** `t(key)` falls back to the key string when not found; easy to add zh key but forget en
**How to avoid:** Add keys to BOTH `zh` and `en` blocks in a single edit; use TypeScript's `TranslationKey` type to get compiler errors for missing keys
**Warning signs:** Raw key strings visible in en locale; TypeScript type error if using typed key

### Pitfall 5: Asset upload overwrites existing file silently
**What goes wrong:** Two files with same name — second upload silently overwrites first on disk
**Why it happens:** `fs.promises.writeFile` overwrites by default
**How to avoid:** Before writing, check if file exists and either reject with error or append a timestamp suffix to the filename
**Warning signs:** Asset count in DB increases but old file disappears

### Pitfall 6: Image preview broken for non-image assets
**What goes wrong:** `<img>` tag shows broken image icon for PDF or text files
**Why it happens:** Treating all assets as images
**How to avoid:** Check `mimeType` field; only render `<img>` for `image/*` MIME types; for others render a file icon + download link
**Warning signs:** Broken image icons for PDF/TXT assets

## Code Examples

Verified patterns from existing project sources:

### Category filter (matches BoardFilters pattern)
```typescript
// Source: src/components/board/board-filters.tsx pattern
const ALL_CATEGORIES = ["all", ...NOTE_CATEGORIES_PRESET]; // from src/lib/constants.ts

function CategoryFilter({ active, onSelect }: { active: string; onSelect: (cat: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-1.5">
      {ALL_CATEGORIES.map((cat) => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          className={cn(
            "rounded-md px-3 py-1 text-sm transition-colors",
            active === cat
              ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/20"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          {cat === "all" ? t("notes.allCategories") : cat}
        </button>
      ))}
    </div>
  );
}
```

### Asset list item with conditional preview
```typescript
// Source: based on MIME_MAP from src/lib/file-serve.ts
function AssetItem({ asset }: { asset: ProjectAsset }) {
  const url = localPathToApiUrl(asset.path); // from src/lib/file-serve.ts
  const isImage = asset.mimeType?.startsWith("image/");

  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      {isImage ? (
        <img src={url} alt={asset.filename} className="h-10 w-10 rounded object-cover" />
      ) : (
        <FileIcon mimeType={asset.mimeType} /> // lucide-react icon
      )}
      <span className="flex-1 text-sm">{asset.filename}</span>
      <a href={url} download={asset.filename} className="text-xs text-muted-foreground hover:text-foreground">
        {t("assets.download")}
      </a>
    </div>
  );
}
```

### Note card with edit/delete actions
```typescript
// Based on task-card.tsx pattern
function NoteCard({ note, onEdit, onDelete }: NoteCardProps) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-sm">{note.title}</p>
          <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {note.category}
          </span>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onEdit(note)} className="..."><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={() => onDelete(note.id)} className="..."><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-2 prose prose-sm dark:prose-invert max-h-24 overflow-hidden">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content.slice(0, 300)}</ReactMarkdown>
      </div>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pages Router file-based routing | App Router with Server Components | Next.js 13+ | Data fetching happens server-side in page.tsx; params/searchParams are Promises in Next.js 16 |
| getServerSideProps / getStaticProps | async Server Components | Next.js 13+ | Data fetching is just `await db.x.findMany()` inside the page component |
| next/router | next/navigation useRouter | App Router | Must use `useRouter` from `next/navigation` not `next/router` |

**Deprecated/outdated:**
- `import { useRouter } from "next/router"`: Never use — App Router requires `"next/navigation"`
- `params.workspaceId` (direct access without await): Deprecated in Next.js 15, removed/broken in Next.js 16

## Open Questions

1. **@uiw/react-md-editor React 19 + Next.js 16 hydration**
   - What we know: Peer deps say `>=16.8.0`; dynamic import with ssr:false is the documented SSR workaround; version 4.0.11 is the latest
   - What's unclear: Whether CodeMirror-based editor has issues with React 19's concurrent rendering or Next.js 16-specific behavior
   - Recommendation: First task in Phase 7 should be a small probe — install and render the editor in isolation; if any errors appear, switch to textarea+react-markdown immediately (fallback is fully viable)

2. **Asset upload — write directly or via API route?**
   - What we know: Next.js 16 server actions support FormData; `file.arrayBuffer()` works in server actions
   - What's unclear: Whether streaming large files via server action is appropriate (likely fine for project assets which are typically small)
   - Recommendation: Use server action with FormData for simplicity; if files are >10MB, revisit with streaming API route

3. **Notes page navigation — separate route or board tab?**
   - What we know: Archive uses a separate route `/workspaces/[workspaceId]/archive`; board page is already complex
   - What's unclear: Whether the design calls for Notes/Assets to be accessible while the board is visible (side-by-side), or as replacement views
   - Recommendation: Separate routes matching archive pattern — `/workspaces/[workspaceId]/notes` and `/workspaces/[workspaceId]/assets`; navigation links can be added to the sidebar or as tab buttons above the project tabs

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| @uiw/react-md-editor | UI-01 Markdown editor | Not installed | — (4.0.11 on npm) | textarea + react-markdown (already installed) |
| react-markdown | Markdown rendering (fallback + note card preview) | Already installed | 10.1.0 | — |
| @tailwindcss/typography | Prose styling for Markdown | Already installed | 0.5.19 | Plain text rendering |
| lucide-react | Icons | Already installed | 1.6.0 | — |
| Vitest + @testing-library/react | Tests | Already installed | vitest 4.1.1, @testing-library/react 16.3.2 | — |

**Missing dependencies with no fallback:**
- None that block execution

**Missing dependencies with fallback:**
- `@uiw/react-md-editor` — not installed; fallback is textarea+react-markdown which IS installed

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 + @testing-library/react 16.3.2 |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run -- tests/unit/components/notes` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | NoteCard renders title, category, content preview | unit | `pnpm test:run -- tests/unit/components/notes/note-card.test.tsx` | Wave 0 |
| UI-01 | CategoryFilter shows correct active state | unit | `pnpm test:run -- tests/unit/components/notes/category-filter.test.tsx` | Wave 0 |
| UI-01 | NoteEditor renders textarea (fallback) or editor with value | unit | `pnpm test:run -- tests/unit/components/notes/note-editor.test.tsx` | Wave 0 |
| UI-02 | AssetList renders filename and download link | unit | `pnpm test:run -- tests/unit/components/assets/asset-list.test.tsx` | Wave 0 |
| UI-02 | Image asset shows img tag; non-image shows file icon | unit | `pnpm test:run -- tests/unit/components/assets/asset-item.test.tsx` | Wave 0 |
| UI-01 + UI-02 | i18n keys render correct zh/en strings | unit | included in component tests | Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm test:run -- tests/unit/components/notes tests/unit/components/assets`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/components/notes/` directory — new; create note-card, category-filter, note-editor tests
- [ ] `tests/unit/components/assets/` directory — new; create asset-item, asset-list tests
- [ ] i18n mock in tests: tests need `I18nProvider` wrapper or mock of `useI18n` (follow existing board-stats.test.tsx pattern which gets zh by default)

## Sources

### Primary (HIGH confidence)
- Codebase direct read — `src/lib/i18n.tsx`, `src/actions/note-actions.ts`, `src/actions/asset-actions.ts`, `src/lib/file-serve.ts`, `src/lib/constants.ts`, `src/lib/file-utils.ts`
- Codebase direct read — `src/app/workspaces/[workspaceId]/page.tsx`, `board-page-client.tsx`, `archive/page.tsx` (page patterns)
- Codebase direct read — `src/components/ui/tabs.tsx` (Tabs component API)
- `npm view @uiw/react-md-editor version` → 4.0.11
- `npm view @uiw/react-md-editor peerDependencies` → `react: >=16.8.0`
- `package.json` — confirmed react-markdown@10.1.0, @tailwindcss/typography@0.5.19 already installed
- STATE.md accumulated decisions — locked hydration risk and fallback strategy

### Secondary (MEDIUM confidence)
- @uiw/react-md-editor docs pattern (dynamic import with ssr:false) — widely documented Next.js pattern for CodeMirror-based editors

### Tertiary (LOW confidence)
- React 19 + Next.js 16 concurrent rendering edge cases with CodeMirror — not verified against official changelogs; mitigated by having a complete fallback

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in package.json or npm registry
- Architecture: HIGH — patterns directly read from existing codebase
- Pitfalls: HIGH — Next.js 16 params/Promise behavior confirmed by reading existing page.tsx files; @uiw SSR risk confirmed by STATE.md decision
- i18n: HIGH — translation system fully read; pattern is clear

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable stack; @uiw SSR risk is the only moving target)
