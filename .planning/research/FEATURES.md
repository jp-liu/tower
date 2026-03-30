# Feature Research

**Domain:** Global search enhancement — cross-type "All" search, notes search, asset search with metadata
**Researched:** 2026-03-30
**Confidence:** HIGH (codebase is fully known; UX patterns are well-established)

---

## Context

This is a subsequent milestone on an existing app. The existing search dialog has:
- Three fixed tabs: Task / Project / Repository
- Debounced (250ms) search firing per active tab
- FTS5 full-text search infrastructure exists for notes (`notes_fts` virtual table, trigram tokenizer)
- `ProjectAsset` model has no `description` field yet

The milestone adds: an "All" tab (cross-type unified search), a Note tab (FTS5), an Asset tab (filename + description), and a `description` field on `ProjectAsset`.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any cross-type search. Missing these makes the search feel broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| "All" tab with grouped results by type | Spotlight/Linear/Notion established this norm — users type once, see everything | MEDIUM | Fire all 5 searches in parallel; render each type section only if it has results |
| Type label/section header per result group | Without grouping headers, a flat mixed list is disorienting | LOW | e.g. "Tasks (3)", "Notes (2)" section dividers |
| Per-type result count shown in section header | Users need at-a-glance density signal before scrolling | LOW | Show "(N)" count next to section title |
| Note search via FTS5 title + content | FTS5 is already wired for per-project; extend to global (no projectId filter) | LOW | Reuse `searchNotes` in `fts.ts`, drop `projectId` filter or pass null |
| Asset search by filename | Filename is primary identifier; basic LIKE search matches existing pattern | LOW | `filename LIKE %q%` on `ProjectAsset` |
| Asset search by description | Description is the new metadata field being added; must be co-searchable | LOW | Requires `description` field on `ProjectAsset` first |
| `description` field on `ProjectAsset` schema | Assets with only a filename are hard to find — description makes them discoverable | LOW | Prisma migration: add nullable `String?` field |
| Upload dialog `description` input | User must be able to set description at upload time | LOW | Add textarea/input to the existing upload dialog |
| Preserve existing tabs (Task/Project/Repository) | Users already rely on precise per-type search; removing it would regress UX | LOW | Keep all 3 tabs; add All + Note + Asset as new tabs |
| Note result navigates to note in project | Search result must be actionable — clicking a note result must open it | MEDIUM | Add `navigateTo` route that opens notes panel for the right project |
| Asset result navigates to asset in project | Same principle as notes — result must land user on the relevant asset | MEDIUM | Route to assets panel for the project |

### Differentiators (Competitive Advantage)

Features that make this search better than the baseline expectation for a local AI task manager.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Note results show content snippet | FTS5 already has content; showing a 1-line excerpt dramatically reduces time to confirm relevance | LOW | Truncate `content` to ~80 chars in `subtitle` field of SearchResult |
| Result type icon differentiation | Notes and assets have different icons than tasks/projects — visual scanning speed increases | LOW | Add `BookOpen` for notes, `Paperclip` for assets in `CATEGORY_DEFS` |
| "All" tab capped per-type (3-5 per type) | Prevents one content type from flooding the "All" view | LOW | `take: 5` per type in the parallel search fan-out |
| Empty-state per section in "All" tab | When a type has 0 results, omit its section entirely — cleaner than empty group headers | LOW | Conditional rendering, no extra work |
| Asset result shows file type hint | Users scanning assets benefit from a visual "image / pdf / etc." indicator | LOW | Parse `mimeType` already stored on `ProjectAsset` |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Keyboard arrow navigation through results | Common in command palettes (Linear, Raycast) | Medium implementation cost; state management adds risk; not in scope for this milestone | Defer to v0.4+; mouse/click navigation is sufficient for MVP |
| Real-time result count badge on tabs | Keeps users informed of density across tabs | Requires firing all 5 searches regardless of active tab — wasteful at query time | Only fire the active tab's search; show count only in "All" grouped headers |
| Fuzzy/typo-tolerant search | Nice for short queries | FTS5 trigram already handles partial matches adequately; adding fuzzy adds complexity and edge cases | Keep FTS5 + LIKE fallback as-is |
| Semantic / embedding-based search | "Understands intent" | Out of scope per PROJECT.md (explicitly deferred); FTS5 is sufficient for current scale | Stay with FTS5 + LIKE; defer to v1.0+ if ever |
| Search history / recent items | Reduces re-typing for frequent items | Requires persistent storage of queries per user; no user model exists (localhost tool) | Defer indefinitely; out of scope |
| Inline asset preview in search results | Power feature | Adds significant complexity to the dialog (image sizing, overflow); results list would become cluttered | Navigate to asset page on click; preview lives there |
| Per-workspace search scoping | Useful in large multi-workspace setups | Adds a filter dimension to an already-multi-tab UI; current user base is small, single developer | Not needed now; the subtitle already shows workspace/project path |

---

## Feature Dependencies

```
[ProjectAsset.description field (schema migration)]
    └──required by──> [Asset search by description]
    └──required by──> [Upload dialog description input]

[Asset search by filename + description]
    └──required by──> [Asset tab in search dialog]
    └──feeds into──> ["All" tab asset section]

[Note search via FTS5 (global, no projectId filter)]
    └──required by──> [Note tab in search dialog]
    └──feeds into──> ["All" tab note section]

["All" tab grouped results]
    └──requires──> [Note search]
    └──requires──> [Asset search]
    └──requires──> [existing Task / Project / Repository search]
    └──requires──> [type-aware result rendering with section headers]

[Note result navigateTo route]
    └──required by──> [Note tab] and ["All" tab note section]

[Asset result navigateTo route]
    └──required by──> [Asset tab] and ["All" tab asset section]
```

### Dependency Notes

- **Schema migration blocks asset search:** `description` field must exist in Prisma schema and DB before asset search queries can reference it. Migration first, search second.
- **FTS5 global note search is low-risk:** `searchNotes` in `fts.ts` already works; just drop the `projectId` filter for a global variant.
- **"All" tab depends on all other types:** implement per-type search actions first, then compose in the "All" handler.
- **Upload dialog description input is independent:** can be done in parallel with search changes once schema migration lands.
- **i18n keys needed for new tabs:** Note, Asset, and All tab labels must have zh/en translations before UI ships.

---

## MVP Definition

### Launch With (v0.3 — this milestone)

- [ ] `ProjectAsset.description` field (nullable `String?`) — schema migration, update `createAsset` / `uploadAsset` actions
- [ ] Upload dialog `description` input — passes description to `uploadAsset`
- [ ] Note search action (global, no projectId filter) — extend or add `globalSearchNotes` in `search-actions.ts`
- [ ] Asset search action (filename + description LIKE) — add `globalSearchAssets` in `search-actions.ts`
- [ ] `SearchCategory` type extended to include `"note"` | `"asset"` | `"all"`
- [ ] `globalSearch` updated to handle new categories including `"all"` fan-out
- [ ] `SearchDialog` new tabs: All, Note, Asset (extending `CATEGORY_DEFS`)
- [ ] "All" grouped result rendering with section headers
- [ ] i18n keys for new tabs and sections (zh + en)

### Add After Validation (v0.4+)

- [ ] Keyboard arrow navigation through search results — adds power-user speed
- [ ] Note result content snippet (excerpt in subtitle) — improves result relevance scanning

### Future Consideration (v1.0+)

- [ ] Semantic / embedding-based search
- [ ] Search history / recent queries
- [ ] Per-workspace scoping filter

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `ProjectAsset.description` schema field | HIGH | LOW | P1 |
| Upload dialog description input | HIGH | LOW | P1 |
| Note search (FTS5 global) | HIGH | LOW | P1 |
| Asset search (filename + description) | HIGH | LOW | P1 |
| "All" tab with grouped results | HIGH | MEDIUM | P1 |
| Type section headers in "All" tab | HIGH | LOW | P1 |
| Note / Asset result navigation routes | HIGH | MEDIUM | P1 |
| i18n keys for new tabs | MEDIUM | LOW | P1 |
| Note content snippet in subtitle | MEDIUM | LOW | P2 |
| Keyboard arrow navigation | MEDIUM | MEDIUM | P3 |
| Per-type count on tab headers | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for this milestone
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Existing Infrastructure — Reuse Points

These are already built and must be reused, not rebuilt.

| Existing Asset | Reuse In |
|----------------|----------|
| `src/lib/fts.ts` — `searchNotes(db, projectId, query)` | Global note search: drop `projectId` filter, or add `globalSearchNotes` variant |
| `src/actions/search-actions.ts` — `globalSearch(query, category)` | Extend to handle `"note"`, `"asset"`, `"all"` categories |
| `src/components/layout/search-dialog.tsx` — tab + result rendering | Add 3 new entries to `CATEGORY_DEFS`; extend result rendering for group headers |
| `SearchResult` interface — `{ id, type, title, subtitle, navigateTo }` | All new result types map cleanly to this shape |
| Debounce pattern (250ms, `timerRef`) | No change needed; works for all categories |
| `ProjectAsset` model and `asset-actions.ts` | Add `description` field; update create/upload actions |

---

## Competitor Feature Analysis

| Feature | Linear | Notion | Jira | Our Approach |
|---------|--------|--------|------|--------------|
| Cross-type "All" search | Yes — grouped sections in command palette | Yes — all content types in sidebar search | Yes — global issue/project/wiki search | Grouped sections in existing dialog |
| Result type section headers | Yes, with type label | Yes, with content-type label | Yes, per type | Section header per type in "All" tab |
| Notes/docs in search | Yes (issues + docs) | Core feature | Pages/wiki in search | Note tab + All tab |
| File/attachment search | Limited | Yes (attachments) | Attachment search via JQL | Asset tab + All tab |
| Keyboard navigation | Yes, arrow keys | Yes | Yes | Deferred — not blocking MVP |
| Per-result type icon | Yes | Yes | Yes | Yes — distinct icons per type |

---

## Sources

- Codebase analysis: `src/actions/search-actions.ts`, `src/lib/fts.ts`, `src/components/layout/search-dialog.tsx`, `prisma/schema.prisma`
- PROJECT.md milestone definition (v0.3 goal and out-of-scope list)
- [Command Palette UX Patterns — Alicja Suska](https://medium.com/design-bootcamp/command-palette-ux-patterns-1-d6b6e68f30c1)
- [Command Palette Interfaces — Philip Davis](https://philipcdavis.com/writing/command-palette-interfaces)
- [Search UX Best Practices — Pencil & Paper](https://www.pencilandpaper.io/articles/search-ux)
- [Master Search UX in 2026 — DesignMonks](https://www.designmonks.co/blog/search-ux-best-practices)

---

*Feature research for: ai-manager v0.3 global search enhancement*
*Researched: 2026-03-30*
