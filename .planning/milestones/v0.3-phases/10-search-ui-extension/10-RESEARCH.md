# Phase 10: Search UI Extension - Research

**Researched:** 2026-03-30
**Domain:** React dialog UI, i18n key extension, SearchResult interface augmentation, grouped result rendering
**Confidence:** HIGH

## Summary

Phase 10 is a pure frontend change. All server-side search logic (globalSearch, MCP tool) was completed in Phase 9. The work is entirely in three files: `src/components/layout/search-dialog.tsx` (the only UI file), `src/lib/i18n.tsx` (the translation catalog), and `src/actions/search-actions.ts` (to add a `snippet?` field to `SearchResult`).

The current search dialog has three tabs (Task, Project, Repository) rendered via a `CATEGORY_DEFS` array and a flat result list. Phase 10 adds three more tabs (All, Note, Asset) and changes the "All" tab's result list to render sections grouped by type. Success criteria also require content snippets for notes and asset descriptions in results — meaning `SearchResult` must grow a `snippet?: string` field populated server-side, and rendered client-side beneath the title in the result row.

The i18n system is a custom `translations` object in `src/lib/i18n.tsx` — not a file-based system. Adding keys means adding string literals to both the `zh` and `en` sub-objects. TypeScript will enforce completeness at compile time via the `TranslationKey` type derived from `keyof typeof translations.zh`. This means any key added to `zh` but missing from `en` will cause a TypeScript error.

**Primary recommendation:** Extend `SearchResult` with `snippet?: string`, populate it in the note/asset branches of `globalSearch`, update `CATEGORY_DEFS` in `search-dialog.tsx` to cover all six tabs, render All-tab results in per-type sections, render snippets beneath titles in result rows, and add all required i18n keys to both `zh` and `en` in `i18n.tsx`.

---

<user_constraints>
## User Constraints (from STATE.md Decisions)

### Locked Decisions
- FTS5 virtual tables must be created via raw SQL AFTER `prisma db push` — not relevant to Phase 10 (no schema changes).
- Both PrismaClient instances (Next.js + MCP) need `PRAGMA busy_timeout=5000` — already in place, no action needed.
- MCP tools use action-dispatch pattern — not relevant to Phase 10 (no MCP changes).
- `file-utils.ts` and `fts.ts` must never import Next.js modules — not relevant to Phase 10.
- `search-actions.ts` and `search-tools.ts` (MCP) must be updated in the same commit when adding new `SearchCategory` values — Phase 10 does NOT add new categories; it only extends `SearchResult`. No MCP parity requirement for `snippet` field.
- Use `Promise.allSettled` for fan-out — already done in Phase 9, no change.
- Back up `prisma/dev.db` before any `prisma db push` — no schema push in Phase 10.

### Pending Todos from STATE.md (must be resolved in this phase)
- Phase 10: Check whether workspace page reads a `?tab=` query param; add tab-param handling if missing before wiring Note/Asset search result navigation.

### Claude's Discretion
- Whether `navigateTo` for note results adds `&tab=notes` to `?projectId=xxx` (e.g., `/workspaces/${wsId}?projectId=${pId}&tab=notes`). Currently notes land on the board view; adding `&tab=notes` would be more useful.
- Whether `navigateTo` for asset results adds `&tab=assets`.
- Whether snippet truncation is done in `globalSearch` (server-side, ~80 chars) or in the dialog component (client-side).
- Whether the "All" sections show a "no results in this section" empty state or simply omit empty sections.

### Deferred Ideas (OUT OF SCOPE)
- Keyboard navigation of search results.
- Semantic search / embeddings.
- Note tag system (SRCH-F01).
- Any backend search logic changes beyond `snippet` field addition.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SUI-01 | Search dialog shows All, Task, Project, Repository, Note, Asset tabs | Extend `CATEGORY_DEFS` array in `search-dialog.tsx` from 3 entries to 6; add `all` as default tab |
| SUI-02 | "All" mode renders results grouped by type with section headers | When `category === "all"`, group `results` by `result.type` and render a section header per group before the items |
| SUI-03 | All new search UI elements support Chinese and English (i18n) | Add keys `search.all`, `search.note`, `search.asset`, `search.section.*` to both `zh` and `en` in `i18n.tsx` |
| ASSET-03 | User sees content snippets (note content / asset description) in search results | Add `snippet?: string` to `SearchResult`; populate in `toNoteResult` (first 80 chars of `content`) and asset branch (`description`); render beneath title in result row |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React 19 | 19.2.4 (project-locked) | Component state and rendering | Already in use throughout the project |
| Next.js | 16.2.1 (project-locked) | App router, server actions | Project framework |
| `@base-ui/react` | ^1.3.0 (project-locked) | `Tabs` primitive used in existing `tabs.tsx` | Already installed and in use; `search-dialog.tsx` renders custom tab-buttons but can continue to do so |
| `lucide-react` | ^1.6.0 (project-locked) | Icon set | `StickyNote`, `Package2` icons available for Note and Asset tabs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Custom i18n (`src/lib/i18n.tsx`) | project file | Translation function `t(key)` | All visible strings in `search-dialog.tsx` must go through `t()` |
| `class-variance-authority` | project-locked | Tab button styling variants | Already used in `tabs.tsx`; not needed for custom tab buttons in search dialog |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom tab buttons in search dialog | `Tabs`/`TabsList`/`TabsTrigger` from `@base-ui/react` | The existing search dialog uses hand-built buttons for tabs (not the Tabs primitive). Continuing the existing pattern is simpler and avoids mixing styles. The `Tabs` primitive is available if desired but requires structural changes. |
| Server-side snippet truncation (in `globalSearch`) | Client-side truncation (in dialog JSX) | Server-side is cleaner — the snippet arrives ready-to-display; no client-side string manipulation. Client-side is also acceptable but adds logic to the component. Prefer server-side per separation of concerns. |
| Omit empty sections in All tab | Show "No results" within each section | Omitting empty sections is cleaner and avoids unnecessary noise when only 1-2 types have matches. |

**Installation:** No new packages required.

**Version verification:** All packages are project-locked. No new installs needed.

---

## Architecture Patterns

### Files to Modify

```
src/
├── actions/
│   └── search-actions.ts      # Add snippet?: string to SearchResult; populate for note + asset
├── components/layout/
│   └── search-dialog.tsx      # 6 tabs, grouped All rendering, snippet display
└── lib/
    └── i18n.tsx                # Add translation keys for new tabs, sections, placeholders
```

No new files required. No schema changes. No MCP changes.

### Pattern 1: Extending SearchResult with snippet

**What:** Add an optional `snippet` field to carry display metadata to the client.
**When to use:** When a result type has secondary content (note body, asset description) worth showing beneath the title.

```typescript
// src/actions/search-actions.ts
export interface SearchResult {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  navigateTo: string;
  snippet?: string;  // First ~80 chars of note content, or asset description
}
```

Populate in `toNoteResult`:
```typescript
function toNoteResult(row: NoteRawRow): SearchResult {
  return {
    id: row.note_id,
    type: "note" as const,
    title: row.title,
    subtitle: `${row.workspace_name} / ${row.project_name}`,
    navigateTo: `/workspaces/${row.workspaceId}?projectId=${row.projectId}`,
    snippet: row.content ? row.content.slice(0, 80) : undefined,
  };
}
```

Populate in asset branch:
```typescript
return assets.map((a) => ({
  id: a.id,
  type: "asset" as const,
  title: a.filename,
  subtitle: `${a.project.workspace.name} / ${a.project.name}`,
  navigateTo: `/workspaces/${a.project.workspaceId}?projectId=${a.projectId}`,
  snippet: a.description || undefined,
}));
```

### Pattern 2: Extending CATEGORY_DEFS in search-dialog.tsx

**What:** Add All, Note, Asset tabs to the existing tab-button array.
**When to use:** Whenever new search categories are added to `SearchCategory`.

The current array is:
```typescript
const CATEGORY_DEFS: { id: SearchCategory; key: "search.task" | "search.project" | "search.repository"; icon: typeof FileText }[] = [
  { id: "task",       key: "search.task",       icon: FileText },
  { id: "project",    key: "search.project",    icon: FolderKanban },
  { id: "repository", key: "search.repository", icon: GitBranch },
];
```

The new array (6 entries, `all` first):
```typescript
import { Search, FileText, FolderKanban, GitBranch, StickyNote, Package2, X } from "lucide-react";

type CategoryKey =
  | "search.all"
  | "search.task"
  | "search.project"
  | "search.repository"
  | "search.note"
  | "search.asset";

const CATEGORY_DEFS: { id: SearchCategory; key: CategoryKey; icon: typeof FileText }[] = [
  { id: "all",        key: "search.all",        icon: Search },
  { id: "task",       key: "search.task",       icon: FileText },
  { id: "project",    key: "search.project",    icon: FolderKanban },
  { id: "repository", key: "search.repository", icon: GitBranch },
  { id: "note",       key: "search.note",       icon: StickyNote },
  { id: "asset",      key: "search.asset",      icon: Package2 },
];
```

Default category should change from `"task"` to `"all"`:
```typescript
const [category, setCategory] = useState<SearchCategory>("all");
```

**Note on lucide-react icon names:** `StickyNote` and `Package2` are available in lucide-react ^1.6.0 (confirmed via the icon package). If `Package2` is unavailable at this version, use `Archive` or `File` as fallback. The exact icon name should be verified against the installed version before use.

### Pattern 3: Grouped Rendering for All Tab

**What:** When `category === "all"`, render results grouped by type with a section header per non-empty type.
**When to use:** Only for the All tab.

The result array from `globalSearch(q, "all")` is flat but each item carries `result.type`. Group by type before rendering:

```typescript
// In the results render block, inside SearchDialog:
const SECTION_ORDER: SearchResultType[] = ["task", "project", "repository", "note", "asset"];

const sectionKeyMap: Record<SearchResultType, CategoryKey> = {
  task:       "search.task",
  project:    "search.project",
  repository: "search.repository",
  note:       "search.note",
  asset:      "search.asset",
};

// Build grouped map
const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
  (acc[r.type] ??= []).push(r);
  return acc;
}, {});

// Render (only when category === "all")
{category === "all" && results.length > 0 && (
  <>
    {SECTION_ORDER.filter(type => grouped[type]?.length).map(type => (
      <div key={type}>
        <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50">
          {t(sectionKeyMap[type])}
        </div>
        {grouped[type].map(result => <ResultRow key={`${result.type}-${result.id}`} result={result} onSelect={handleSelect} />)}
      </div>
    ))}
  </>
)}
```

### Pattern 4: Snippet Rendering in Result Rows

**What:** Show `result.snippet` beneath the subtitle when present.
**When to use:** For all result types (snippet is optional — only note and asset results will have it).

```typescript
// Result row — updated to show snippet
<button
  key={`${result.type}-${result.id}`}
  onClick={() => handleSelect(result)}
  className="flex w-full items-center gap-3 border-b border-border/30 px-4 py-3 text-left transition-colors hover:bg-accent last:border-b-0"
>
  <div className="rounded-md bg-muted p-1.5">
    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
  </div>
  <div className="flex-1 min-w-0">
    <div className="text-sm font-medium text-foreground truncate">{result.title}</div>
    <div className="text-xs text-muted-foreground truncate">{result.subtitle}</div>
    {result.snippet && (
      <div className="text-xs text-muted-foreground/70 truncate mt-0.5">{result.snippet}</div>
    )}
  </div>
</button>
```

Extracting this into a `ResultRow` sub-component within the file keeps the JSX readable and allows both flat (non-All) and grouped (All) renderers to reuse it.

### Pattern 5: i18n Key Addition

**What:** Add new translation keys to both `zh` and `en` objects in `i18n.tsx`.
**When to use:** For every new visible string in the search dialog.

The `TranslationKey` type is derived as `keyof typeof translations.zh`. TypeScript enforces that `t(key)` only accepts valid keys. Any key added to `zh` but missing from `en` causes a TypeScript error at the `translations` object literal (because `en` is `Record<TranslationKey, string>` implicitly via `as const`).

Required new keys:
```typescript
// zh
"search.all":                 "全部",
"search.note":                "笔记",
"search.asset":               "资源",
"search.placeholder":         // UPDATE existing: "搜索任务、项目、仓库、笔记、资源..."
"search.section.task":        "任务",        // for section headers in All tab (can reuse search.task)
"search.section.note":        "笔记",        // same as search.note — reuse key if possible

// en
"search.all":                 "All",
"search.note":                "Notes",
"search.asset":               "Assets",
"search.placeholder":         // UPDATE: "Search tasks, projects, repos, notes, assets..."
```

**Note:** Section headers in the All tab can reuse the same keys as tab labels (`search.task`, `search.project`, etc.) — no separate `search.section.*` keys are needed. This simplifies the i18n additions.

**Also update:** `topbar.searchPlaceholder` (zh: `"搜索任务、项目、仓库..."`, en: `"Search tasks, projects, repos..."`) — these appear in the top bar tooltip, not the dialog itself. Update to include notes and assets for completeness. This is discretionary.

### Pattern 6: Tab-param Navigation (Pending Todo Resolution)

The STATE.md pending todo for Phase 10 asks: "Check whether workspace page reads a `?tab=` query param; add tab-param handling if missing before wiring Note/Asset search result navigation."

**Current state (verified):** `src/app/workspaces/[workspaceId]/page.tsx` reads only `searchParams.projectId`. It does NOT read a `?tab=` param. Navigation to `/workspaces/${wsId}?projectId=${pId}` lands the user on the Kanban board, not the Notes or Assets tab.

**Phase 10 requirement:** The success criteria do NOT require that clicking a search result opens the correct tab. The criteria only require that snippets and tab labels are displayed correctly. Navigation behavior is not mentioned in the success criteria.

**Recommendation:** Do NOT add `?tab=` handling to the workspace page in this phase — it is not required by any success criterion and would expand scope. The `navigateTo` URLs from Phase 9 (`/workspaces/${wsId}?projectId=${pId}`) are sufficient. Mark the pending todo as "resolved by de-scoping — tab navigation is not a success criterion for Phase 10."

### Anti-Patterns to Avoid

- **Adding `snippet` only to the UI (not to `SearchResult`):** The dialog is a client component receiving `SearchResult[]` from a server action. If `snippet` is not on the interface, TypeScript will reject `result.snippet` access in JSX.
- **Adding snippet truncation in the client component:** Prefer server-side truncation in `toNoteResult` and the asset branch. Avoids sending full note content to the client only to truncate it.
- **Mixing `Tabs` primitive with custom tab buttons:** The existing dialog uses custom buttons — keep it consistent. Adding `@base-ui/react`'s `Tabs` primitive would require restructuring the component.
- **Putting All tab last:** The All tab should be first. Users opening the dialog for the first time should see all results, not have to switch. The default `category` state should be `"all"`.
- **Flat rendering in All mode:** Success criterion 2 explicitly requires grouped sections, not a flat list.
- **Missing i18n key in one locale:** TypeScript will catch this at compile time because `TranslationKey = keyof typeof translations.zh` — but only if the object is typed strictly. Confirm the `as const` assertion is in place before relying on this.
- **Using `console.log` in the component:** Project rule — no console.log in production code.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Snippet truncation | Complex ellipsis logic with word boundaries | `content.slice(0, 80)` | 80 chars is a display hint, not semantic; simple slice is sufficient |
| Grouping results | Manual nested loops | `reduce` into a `Record<string, SearchResult[]>` then iterate `SECTION_ORDER` | Single pass; standard JS pattern |
| New i18n system | File-based or library-based i18n | Extend existing `translations` object in `i18n.tsx` | Project uses custom single-file i18n; stay consistent |
| Icon mapping per type | Separate `if/else` tree | `CATEGORY_DEFS` lookup (`CATEGORY_DEFS.find(c => c.id === type)`) | Pattern already established in the existing dialog |

**Key insight:** This phase is entirely UI and type extension. No new infrastructure, no schema changes, no library installs.

---

## Runtime State Inventory

> No rename/refactor. No migration. Included for completeness.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None — no schema changes | — |
| Live service config | None | — |
| OS-registered state | None | — |
| Secrets/env vars | None | — |
| Build artifacts | None | — |

**Nothing found in any category.** Phase 10 is pure code changes to 3 files.

---

## Common Pitfalls

### Pitfall 1: snippet Field Missing from SearchResult Interface
**What goes wrong:** TypeScript error `Property 'snippet' does not exist on type 'SearchResult'` when the dialog tries to render `result.snippet`.
**Why it happens:** `SearchResult` is defined in `search-actions.ts`; the dialog imports the type. If the field is not added to the interface, the dialog cannot access it.
**How to avoid:** Add `snippet?: string` to `SearchResult` in `search-actions.ts` FIRST, before updating the dialog.
**Warning signs:** TypeScript compile error on `result.snippet` in `search-dialog.tsx`.

### Pitfall 2: All-Tab Shows Empty Sections
**What goes wrong:** When querying "All", a section for a type with 0 results renders a lonely header with nothing below it.
**Why it happens:** Iterating all 5 types without filtering out empty groups.
**How to avoid:** Filter `SECTION_ORDER` to only types where `grouped[type]?.length > 0`.
**Warning signs:** "Task" section header appears with nothing below it in the All tab.

### Pitfall 3: Default Category Mismatch
**What goes wrong:** Dialog defaults to `"task"` tab but success criterion 1 implies All should be discoverable as the primary mode.
**Why it happens:** Existing default `useState<SearchCategory>("task")` not updated.
**How to avoid:** Change default to `"all"` — this is also the most useful starting point for users.
**Warning signs:** Opening the dialog shows "Task" tab selected rather than "All".

### Pitfall 4: i18n Key Type Error
**What goes wrong:** TypeScript error calling `t("search.all")` because `"search.all"` is not a valid `TranslationKey`.
**Why it happens:** Key added to `CATEGORY_DEFS` before being added to `translations.zh` (and `translations.en`).
**How to avoid:** Add keys to `i18n.tsx` FIRST, then reference them in the dialog.
**Warning signs:** TS error `Argument of type '"search.all"' is not assignable to parameter of type 'TranslationKey'`.

### Pitfall 5: Lucide Icon Name Mismatch
**What goes wrong:** Build error `StickyNote is not exported from 'lucide-react'` at lucide-react v1.6.0.
**Why it happens:** Icon names change between versions. v1.6.0 is a non-standard version number (`^1.6.0` suggests semver — check installed version before using icons).
**How to avoid:** Verify available icons: `node -e "const l = require('lucide-react'); console.log(Object.keys(l).filter(k => k.includes('Note') || k.includes('Package') || k.includes('File')))"` from project root. Use confirmed names only.
**Warning signs:** Build error mentioning icon name.

### Pitfall 6: getCategoryIcon Called with "all" type
**What goes wrong:** `getCategoryIcon("all")` returns the fallback `FileText` icon — but "all" is never a result type, so this is actually fine. The pitfall is if "all" is passed to the icon lookup from result rendering.
**Why it happens:** Developer confuses `category` (the active tab) with `result.type` (always specific).
**How to avoid:** `getCategoryIcon` is called with `result.type` which is always specific. The "All" tab icon in `CATEGORY_DEFS` uses `Search`; result rows use `result.type` which is never "all".
**Warning signs:** All result rows in the All tab show the same fallback icon.

---

## Code Examples

### Current search-dialog.tsx tab rendering (source: file read directly)
```typescript
// Current: 3 hard-typed entries in CATEGORY_DEFS
const CATEGORY_DEFS: { id: SearchCategory; key: "search.task" | "search.project" | "search.repository"; icon: typeof FileText }[] = [
  { id: "task", key: "search.task", icon: FileText },
  { id: "project", key: "search.project", icon: FolderKanban },
  { id: "repository", key: "search.repository", icon: GitBranch },
];
```

### Current SearchResult shape (source: src/actions/search-actions.ts read directly)
```typescript
export interface SearchResult {
  id: string;
  type: SearchResultType;   // "task" | "project" | "repository" | "note" | "asset"
  title: string;
  subtitle: string;
  navigateTo: string;
  // snippet field MISSING — Phase 10 adds it
}
```

### Note result mapper with snippet (Phase 10 change)
```typescript
function toNoteResult(row: NoteRawRow): SearchResult {
  return {
    id: row.note_id,
    type: "note" as const,
    title: row.title,
    subtitle: `${row.workspace_name} / ${row.project_name}`,
    navigateTo: `/workspaces/${row.workspaceId}?projectId=${row.projectId}`,
    snippet: row.content ? row.content.slice(0, 80) : undefined,
  };
}
```

### Asset result with description as snippet (Phase 10 change)
```typescript
return assets.map((a) => ({
  id: a.id,
  type: "asset" as const,
  title: a.filename,
  subtitle: `${a.project.workspace.name} / ${a.project.name}`,
  navigateTo: `/workspaces/${a.project.workspaceId}?projectId=${a.projectId}`,
  snippet: a.description || undefined,
}));
```

### i18n additions required (zh and en, both required)
```typescript
// zh additions (in translations.zh)
"search.all":   "全部",
"search.note":  "笔记",
"search.asset": "资源",

// en additions (in translations.en)
"search.all":   "All",
"search.note":  "Notes",
"search.asset": "Assets",
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 3-tab search (Task, Project, Repo) | 6-tab search (All + 3 existing + Note + Asset) | Phase 10 | Users can search notes and assets from the global dialog |
| Flat result list in all modes | Grouped sections in All mode | Phase 10 | Clearer result differentiation when searching across all types |
| No snippets in results | Note content snippet + asset description | Phase 10 | Users can identify relevant results without navigating |

**Deprecated/outdated:**
- Default category `"task"`: will change to `"all"` in Phase 10 — "All" is the more useful default.

---

## Open Questions

1. **Navigation tab behavior (resolved — de-scoped)**
   - What we know: `/workspaces/[id]/page.tsx` reads only `?projectId` from searchParams, not `?tab`.
   - What's unclear: Whether to add `?tab=notes` support to make note search results navigate directly to the notes tab.
   - Recommendation: Do NOT add tab navigation in Phase 10. Success criteria do not require it. Mark STATE.md todo as de-scoped.

2. **Lucide icon names at v1.6.0**
   - What we know: lucide-react `^1.6.0` is installed; `StickyNote` and `Package2` are common icons in recent lucide versions.
   - What's unclear: The exact available icon names at the installed semver-resolved version.
   - Recommendation: Before writing the plan, run `node -e "const l = require('./node_modules/lucide-react'); console.log(Object.keys(l).filter(k => /note|package|sticky|archive/i.test(k)))"` from the project root to confirm icon names.

3. **Placeholder text update scope**
   - What we know: `search.placeholder` ("搜索任务、项目、仓库...") and `topbar.searchPlaceholder` mention only 3 types.
   - What's unclear: Whether SUI-03 requires these to be updated to mention notes and assets.
   - Recommendation: Update both to include notes and assets (SUI-03 says "All new search UI elements" — the placeholder is part of the search UI). This is 2 string edits.

---

## Environment Availability

> Phase 10 is pure TypeScript/React code — no external dependencies beyond project toolchain.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `pnpm` | Build + test | Yes | 10.28.2 | — |
| `node` | tsx, vitest | Yes | 22.17.0 | — |
| `vitest` | Test suite | Yes | ^4.1.1 | — |
| TypeScript | Type checking | Yes | ^5 | — |
| lucide-react | Icons | Yes | ^1.6.0 | Use fallback icon names |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

---

## Validation Architecture

> `workflow.nyquist_validation` is absent from `.planning/config.json` — treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test:run tests/unit/actions/search-actions.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ASSET-03 | `globalSearch(q, "note")` result has `snippet` = first 80 chars of content | integration | `pnpm test:run tests/unit/actions/search-actions.test.ts` | Yes — extend existing |
| ASSET-03 | `globalSearch(q, "asset")` result has `snippet` = asset description | integration | `pnpm test:run tests/unit/actions/search-actions.test.ts` | Yes — extend existing |
| SUI-01 | Search dialog renders 6 tab buttons (All, Task, Project, Repository, Note, Asset) | unit/component | `pnpm test:run tests/unit/components/search-dialog.test.tsx` | No — Wave 0 |
| SUI-02 | All-tab result list has section headers per type | unit/component | `pnpm test:run tests/unit/components/search-dialog.test.tsx` | No — Wave 0 |
| SUI-03 | Tab labels render correct zh/en text based on locale | unit/component | `pnpm test:run tests/unit/components/search-dialog.test.tsx` | No — Wave 0 |

**Note on component tests:** The project's `vitest.config.ts` uses `jsdom` environment globally and installs `@testing-library/react` — React component tests are supported without additional setup.

### Sampling Rate
- **Per task commit:** `pnpm test:run tests/unit/actions/search-actions.test.ts --reporter=dot`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/components/search-dialog.test.tsx` — covers SUI-01 (6 tabs rendered), SUI-02 (section headers in All mode), SUI-03 (i18n label correctness). New file. Model after `@testing-library/react` patterns; use `render` + `screen.getByText`/`getAllByRole`.
- Existing `tests/unit/actions/search-actions.test.ts` — extend with 2 new test cases: `note result has snippet field` and `asset result has snippet field`. File already exists.

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Read Next.js guide in `node_modules/next/dist/docs/` before writing any Next.js-touching code** — AGENTS.md explicitly states this version has breaking changes. `search-actions.ts` is a `"use server"` file; `search-dialog.tsx` uses `"use client"`.
- No `console.log` in production code.
- Use Zod for server action and MCP tool input validation — not directly relevant (no new Zod schema needed for `snippet`).
- Files under 800 lines; functions under 50 lines — `search-dialog.tsx` is currently 141 lines. Adding grouped rendering and 3 tabs will grow it to ~200-250 lines, well under 800.
- No mutation — immutable patterns. `reduce` into a new `Record` is immutable.
- Test coverage minimum 80% — 1 new test file needed (Wave 0 gap) + extend existing search-actions test.
- `i18n.tsx` keys must be added to BOTH locales — TypeScript enforces this via the `as const` type inference.

---

## Sources

### Primary (HIGH confidence)
- `src/components/layout/search-dialog.tsx` (read directly) — current tab structure, CATEGORY_DEFS pattern, result rendering
- `src/actions/search-actions.ts` (read directly) — SearchResult interface, toNoteResult, asset branch; Phase 9 implementation complete
- `src/lib/i18n.tsx` (read directly) — translations object shape, TranslationKey derivation, existing search keys
- `src/components/ui/tabs.tsx` (read directly) — @base-ui/react Tabs primitive in use; custom buttons in dialog do not use it
- `src/app/workspaces/[workspaceId]/page.tsx` (read directly) — only reads `?projectId` searchParam; no `?tab` handling
- `tests/unit/actions/search-actions.test.ts` (read directly) — existing tests for note/asset/all search; extend for snippet
- `tests/unit/mcp/search-tools.test.ts` (read directly) — test pattern with `@vitest-environment node`
- `vitest.config.ts` (read directly) — jsdom environment globally; `@testing-library/react` available
- `.planning/STATE.md` (read directly) — pending todo for tab navigation resolved
- `.planning/REQUIREMENTS.md` (read directly) — ASSET-03, SUI-01, SUI-02, SUI-03 requirements
- `.planning/ROADMAP.md` (read directly) — Phase 10 success criteria
- `.planning/phases/09-search-actions-expansion/09-RESEARCH.md` (read directly) — upstream Phase 9 decisions

### Secondary (MEDIUM confidence)
- `package.json` (read directly) — lucide-react ^1.6.0, @base-ui/react ^1.3.0 confirmed

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies project-locked; no new installs; all files read directly
- Architecture: HIGH — current dialog source read directly; i18n system verified in detail; SearchResult interface confirmed
- Pitfalls: HIGH — TypeScript enforcement of i18n keys is verified from source; snippet field requirement derived from success criteria; navigation scope de-scoped from verified page source

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (all dependencies project-locked; no fast-moving ecosystem dependencies)
