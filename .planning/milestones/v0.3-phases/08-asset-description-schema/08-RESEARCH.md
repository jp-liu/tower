# Phase 8: Asset Description Schema - Research

**Researched:** 2026-03-30
**Domain:** Prisma schema extension (nullable column), SQLite db push safety, form validation, i18n keys
**Confidence:** HIGH

## Summary

Phase 8 adds a `description` field to the `ProjectAsset` model and surfaces it through the upload dialog. The work spans four files: `prisma/schema.prisma` (add nullable column), `src/actions/asset-actions.ts` (accept and persist description), `src/components/assets/asset-upload.tsx` (textarea + submit guard), and `src/lib/i18n.tsx` (two new translation keys). The `AssetItemType` interface in `asset-item.tsx` needs updating so the list view can display the description field.

The critical constraint is that `description` MUST be `String? @default("")` (nullable with empty-string default) in Prisma schema. Using a NOT NULL column without a default would require SQLite to backfill existing rows at table-recreation time — and SQLite's `ALTER TABLE ADD COLUMN` only allows constant defaults for NOT NULL columns. Prisma's `db push` on SQLite may perform a destructive table recreation when adding a non-nullable column to an existing table that has rows.

There is currently **1 pre-existing asset** in `dev.db` (filename: `Snipaste_2026-03-27_11-41-19.png`). The migration path is safe only if description is nullable. The locked decision from v0.3 research confirms: `ProjectAsset.description` must be `String? @default("")`.

The upload dialog currently blocks submission when `!selectedFile || !uploadProjectId`. The success criterion says "rejects submission when description is missing", so a `!description.trim()` guard must be added alongside the file check. This means the description field is required at the UI level even though the DB column is nullable — a deliberate design asymmetry that preserves backward compatibility for programmatic asset creation (MCP `manage_assets add` action) while enforcing it in the UI.

**Primary recommendation:** Add `description String? @default("")` to schema, update `createAsset` Zod schema and action signature to accept `description`, add a required textarea to `AssetUpload`, display description in `AssetItem`, add four i18n keys (zh + en). Run `pnpm db:push` with db backup first; verify `notes_fts` survives afterward.

---

<user_constraints>
## User Constraints (from CONTEXT.md / STATE.md Decisions)

### Locked Decisions
- `ProjectAsset.description` must be `String? @default("")` — NOT NULL without default causes table recreation and potential data loss (v0.3 research decision).
- FTS5 virtual tables must be created via raw SQL AFTER `prisma db push` — never before, or Prisma detects schema drift (pre-v0.2 decision).
- Both PrismaClient instances need `PRAGMA busy_timeout=5000` (pre-v0.2 decision — already in place, no change needed for this phase).
- MCP tools use action-dispatch pattern (`manage_assets`) — Phase 8 should not add new MCP tools; extend the existing `add` action if description support is needed there (pre-v0.2 decision).
- `file-utils.ts` and `fts.ts` must never import Next.js modules (pre-v0.2 decision — not affected by this phase).
- Back up `prisma/dev.db` before running `prisma db push` (Phase 8 pending todo from STATE.md).
- After `db push`, verify `notes_fts` table still exists via `sqlite3 .tables` (Phase 8 pending todo from STATE.md).

### Claude's Discretion
- Whether the MCP `manage_assets add` action should also accept an optional `description` parameter (not required by ASSET-01/02 but forward-compatible with Phase 9).
- Exact placeholder text for the description textarea in zh/en.
- Whether `AssetItem` displays description as a truncated subtitle line or on a separate row.

### Deferred Ideas (OUT OF SCOPE)
- Phase 9 search over asset descriptions (SRCH-02) — this phase only adds the schema and UI field.
- Phase 10 search result display of asset description snippets (ASSET-03) — deferred to Phase 10.
- FTS5 indexing of asset descriptions — not needed until Phase 9.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ASSET-01 | User can add a required description when uploading an asset | `AssetUpload` dialog gains a textarea; submit guarded by `!description.trim()` |
| ASSET-02 | ProjectAsset model includes description field persisted to database | `description String? @default("")` added to Prisma schema; `createAsset` action accepts and stores it |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@prisma/client` | 6.19.2 (project-locked) | ORM — add `description` column, generate updated types | Already in use; `db push` workflow established |
| `prisma` CLI | 6.19.2 (project-locked) | `pnpm db:push` to apply schema changes | Already in use |
| `zod` | in use (project-locked) | Extend `createAssetSchema` to include `description` | Per project pattern — all server action inputs validated with Zod |
| `react` | 19.2.4 (project-locked) | `useState` for controlled textarea in upload dialog | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:sqlite3` CLI | system | Verify `notes_fts` survives `db push` | Run once after db push: `sqlite3 prisma/dev.db ".tables"` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `String? @default("")` | `String @default("")` (NOT NULL with default) | NOT NULL with default is safe for SQLite ADD COLUMN, but Prisma may choose table recreation instead of ALTER TABLE — nullable is the documented safe choice for this project |
| Nullable column `String?` | Required `String` (no default) | NOT NULL without default forces table recreation and breaks existing rows |

**Installation:** No new packages needed.

---

## Architecture Patterns

### Files to Modify

```
prisma/
└── schema.prisma           # Add: description String? @default("")

src/
├── actions/
│   └── asset-actions.ts    # Extend createAssetSchema + createAsset + uploadAsset signatures
├── components/assets/
│   ├── asset-upload.tsx    # Add description textarea + submit guard
│   └── asset-item.tsx      # Add description display; update AssetItemType interface
└── lib/
    └── i18n.tsx            # Add 4 translation keys (zh + en)
```

No new files required. The MCP `note-asset-tools.ts` may optionally receive an `description?` param on the `add` action for forward-compatibility, but is NOT required by ASSET-01 or ASSET-02.

### Pattern 1: Nullable Column with Default in Prisma (SQLite-safe)

**What:** Add a nullable String column with an empty-string default so existing rows are unaffected.
**When to use:** Any time a new column is added to an existing table that may already have rows.

```prisma
// prisma/schema.prisma — ProjectAsset model addition
model ProjectAsset {
  id          String   @id @default(cuid())
  filename    String
  path        String
  mimeType    String?
  size        Int?
  description String?  @default("")   // <-- new field
  projectId   String
  createdAt   DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}
```

**Why nullable, not NOT NULL with default:** SQLite's `ALTER TABLE ADD COLUMN` supports constant defaults for NOT NULL. However, Prisma's `db push` may choose to recreate the table (drop + create + copy) instead of ALTER TABLE for certain schema changes. Table recreation on a live database risks data loss if the operation fails mid-way. Using `String?` means even if Prisma picks table recreation, the copy-over does not fail for rows missing the column value.

### Pattern 2: Extending the Zod Schema and Server Action

**What:** Add `description` as an optional string to `createAssetSchema`. The upload action passes it through.
**When to use:** Whenever the DB model gains a new user-facing field.

```typescript
// src/actions/asset-actions.ts — updated schema
const createAssetSchema = z.object({
  filename: z.string().min(1).max(255),
  path: z.string().min(1),
  mimeType: z.string().max(100).optional(),
  size: z.number().int().nonnegative().optional(),
  projectId: z.string().min(1),
  description: z.string().max(500).optional(),  // <-- new field
});

// Updated createAsset signature
export async function createAsset(data: {
  filename: string;
  path: string;
  mimeType?: string;
  size?: number;
  projectId: string;
  description?: string;   // <-- new field
}) { ... }

// Updated uploadAsset — extract description from FormData
export async function uploadAsset(formData: FormData) {
  const description = (formData.get("description") as string | null) ?? "";
  // ... existing file handling ...
  const asset = await createAsset({
    filename,
    path: dest,
    mimeType: file.type || undefined,
    size: file.size,
    projectId,
    description: description || undefined,
  });
  return asset;
}
```

**Key detail:** `description` is optional in the action (so MCP `manage_assets add` doesn't break) but the UI dialog enforces it via `!description.trim()` in the submit guard.

### Pattern 3: Upload Dialog textarea + Submit Guard

**What:** Add a controlled textarea for description to `AssetUpload`, block submission when empty.
**When to use:** Success criterion 4 — "upload dialog form rejects submission when description is missing."

```typescript
// src/components/assets/asset-upload.tsx — additions
const [description, setDescription] = useState("");

// Reset on open:
const handleOpen = () => {
  setDescription("");
  // ... existing resets
};

// In the dialog form, after the File field:
<div className="flex items-start gap-3">
  <label className="text-xs text-muted-foreground w-16 shrink-0 pt-1.5">
    {t("assets.description")}
  </label>
  <textarea
    value={description}
    onChange={(e) => setDescription(e.target.value)}
    placeholder={t("assets.descriptionPlaceholder")}
    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-none h-20"
  />
</div>

// Updated submit button disabled condition:
disabled={!selectedFile || !uploadProjectId || !description.trim() || isUploading}

// Updated handleUpload — append description to FormData:
formData.append("description", description.trim());
```

### Pattern 4: AssetItemType and Display

**What:** Add `description` to the `AssetItemType` interface and render it in the item card.
**When to use:** Success criterion 2 — "The submitted description is persisted... and visible after page reload."

```typescript
// src/components/assets/asset-item.tsx — updated interface
export interface AssetItemType {
  id: string;
  filename: string;
  path: string;
  mimeType: string | null;
  size: number | null;
  description: string | null;  // <-- new field
  createdAt: Date;
}

// In the Info section, after filename:
{asset.description && (
  <p className="mt-0.5 text-xs text-muted-foreground truncate">
    {asset.description}
  </p>
)}
```

Pre-existing assets have `description = null` or `""` — the `&&` guard renders nothing for them (success criterion 3 — no error on existing assets).

### Pattern 5: i18n Keys

**What:** Add description label and placeholder in both zh and en.
**When to use:** Any UI text added to the upload dialog or asset list.

New keys needed in `src/lib/i18n.tsx`:

```typescript
// zh section additions:
"assets.description": "描述",
"assets.descriptionPlaceholder": "输入资源描述（可搜索）",

// en section additions:
"assets.description": "Description",
"assets.descriptionPlaceholder": "Enter asset description (searchable)",
```

**TypeScript check:** `TranslationKey` is derived as `keyof typeof translations.zh`. Adding keys to both locales keeps the type consistent. If a key is added to zh but not en (or vice versa), TypeScript will report a type error on the `en` object literal — no extra validation needed.

### Anti-Patterns to Avoid

- **NOT NULL without @default in Prisma schema for an existing table:** Prisma db push may recreate the table and fail mid-copy. Always use nullable `String?` for additive schema changes to live tables.
- **Disabling the submit button only on `!selectedFile`:** The success criterion explicitly requires the form to block when description is missing. Both conditions must be in the `disabled` expression.
- **Appending `description` to FormData only in `uploadAsset`:** `createAsset` must also accept it so that future programmatic callers (MCP) can set it. The Zod schema change must precede the UI wiring.
- **Hardcoding description as required (`z.string().min(1)`) in the Zod schema:** The DB column is nullable; MCP `manage_assets add` does not pass description. Use `z.string().max(500).optional()` — let the UI enforce presence.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Column migration | Custom SQL ALTER TABLE script | `prisma db push` | Handles index recreation, type coercion, and idempotent re-runs |
| Form validation | Manual `if (!description)` in handler | `disabled={...}` prop on button + Zod in action | Prevents submission at UI; Zod catches bypass attempts |
| Translation type-safety | Manual key lookup maps | TypeScript `keyof typeof translations.zh` (existing pattern) | Type error at compile time if key missing from any locale |

**Key insight:** This phase is purely additive — no new infrastructure, no new patterns. All four changed files follow existing project conventions exactly.

---

## Runtime State Inventory

> This phase modifies an existing table that has live data.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | 1 row in `ProjectAsset` table (`Snipaste_2026-03-27_11-41-19.png`, id: `cmnci74t00003cjlta2srhfv2`) | `String? @default("")` means this row gets `description = NULL`; no data migration needed — display logic handles null with `&&` guard |
| Live service config | None | — |
| OS-registered state | None | — |
| Secrets/env vars | None | — |
| Build artifacts | `@prisma/client` generated types will be stale after schema change | Run `pnpm db:push` (which calls `prisma generate` automatically) |

**FTS5 survival check:** `notes_fts` virtual table currently exists (confirmed: `sqlite3 prisma/dev.db ".tables"` shows `notes_fts` and related tables). After `db push`, re-verify with same command. If missing, re-run `pnpm db:init-fts`.

---

## Common Pitfalls

### Pitfall 1: Prisma db push Recreates ProjectAsset Table

**What goes wrong:** Prisma performs a destructive table recreation (DROP + CREATE + data copy) instead of `ALTER TABLE ADD COLUMN` when adding a new column to SQLite. This can fail or silently drop rows if the copy fails partway.
**Why it happens:** Prisma chooses table recreation when changing constraints or adding columns that SQLite's `ADD COLUMN` cannot handle (e.g., columns with computed defaults, UNIQUE constraints). For a simple nullable column, Prisma usually uses ALTER TABLE, but this is not guaranteed.
**How to avoid:** Back up `prisma/dev.db` before running `pnpm db:push`. The STATE.md Pending Todos already flag this for Phase 8.
**Warning signs:** `pnpm db:push` output includes "The migration will be applied" with "recreate table" or "data loss" warnings.

### Pitfall 2: notes_fts Dropped by db push

**What goes wrong:** `prisma db push` drops the `notes_fts` FTS5 virtual table because Prisma doesn't know about it (it was created via raw SQL, not schema.prisma). After push, note search returns errors.
**Why it happens:** Prisma's shadow database comparison includes all tables. If FTS tables appear as "unmanaged schema", Prisma may drop them during reset operations.
**How to avoid:** Always verify after push: `sqlite3 prisma/dev.db ".tables"` must show `notes_fts`. Re-run `pnpm db:init-fts` if missing.
**Warning signs:** Note search returns empty results or throws errors after db push.

### Pitfall 3: AssetItemType Interface Out of Sync

**What goes wrong:** `asset-item.tsx` defines `AssetItemType` with the old fields. After adding `description` to the Prisma model, the type returned by `getProjectAssets` includes `description` but `AssetItemType` doesn't. TypeScript will error on any `asset.description` access.
**Why it happens:** `AssetItemType` is a manually maintained interface, not derived from `Prisma.ProjectAsset`. It was created to decouple the component from the Prisma type.
**How to avoid:** Update `AssetItemType` to include `description: string | null` as part of the same commit that updates the Prisma schema.
**Warning signs:** TypeScript error on `asset.description` in `asset-item.tsx`.

### Pitfall 4: FormData description Missing in uploadAsset

**What goes wrong:** Developer adds the textarea to `AssetUpload` and appends to FormData, but forgets to read `formData.get("description")` in the `uploadAsset` server action. Description is silently ignored.
**Why it happens:** The server action and the client component are in separate files and the connection is implicit through FormData keys.
**How to avoid:** The Zod schema change, action signature change, and FormData extraction must all land in the same commit. The test for `createAsset` must include a `description` field assertion.
**Warning signs:** Description textarea accepts input, upload completes, but `getAssetById` returns `description: null`.

### Pitfall 5: Existing Tests Fail After Zod Schema Change

**What goes wrong:** `tests/unit/lib/asset-actions.test.ts` calls `createAsset` without `description`. After adding `description: z.string().max(500).optional()`, existing tests still pass (optional field). But if the test asserts on the returned object shape and `description` is not in `AssetItemType`, TypeScript will complain.
**Why it happens:** The test creates `createAsset({...})` and then reads the result fields. After schema change, the Prisma return type includes `description`.
**How to avoid:** Keep `description` optional in Zod. Update the test to also verify that `description` is `null` (or `""`) when not provided, confirming the field is persisted.
**Warning signs:** `pnpm test:run` fails on existing `asset-actions.test.ts` tests after schema change.

---

## Code Examples

### Prisma Schema Addition (verified safe pattern)

```prisma
// prisma/schema.prisma — ProjectAsset model
// Source: Locked decision from v0.3 research in STATE.md
model ProjectAsset {
  id          String   @id @default(cuid())
  filename    String
  path        String
  mimeType    String?
  size        Int?
  description String?  @default("")
  projectId   String
  createdAt   DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}
```

### Verify db push Did Not Drop FTS Table

```bash
# Source: STATE.md Pending Todo for Phase 8
sqlite3 prisma/dev.db ".tables"
# Expected output includes: notes_fts  notes_fts_config  notes_fts_content  notes_fts_data  notes_fts_docsize  notes_fts_idx
# If notes_fts is missing: pnpm db:init-fts
```

### Controlled Textarea State Reset on Dialog Open

```typescript
// Source: Existing pattern in asset-upload.tsx handleOpen()
const handleOpen = () => {
  setUploadWsId(initialWsId);
  setUploadProjectId(initialProjectId);
  setSelectedFile(null);
  setDescription("");  // <-- reset description state
  setIsOpen(true);
};
```

### Null-Safe Description Display (backward compatibility)

```typescript
// Source: Success criterion 3 — existing assets show empty description, not error
{asset.description && (
  <p className="mt-0.5 text-xs text-muted-foreground truncate">
    {asset.description}
  </p>
)}
```

---

## Environment Availability

> All dependencies are already installed and confirmed working from previous phases.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `prisma` CLI | `pnpm db:push` | Yes | 6.19.2 | — |
| `sqlite3` CLI | FTS table verification | Yes | bundled with SQLite 3.43.2 | `pnpm db:init-fts` re-creates if needed |
| `pnpm` | all scripts | Yes | 10.28.2 | — |
| `node` | tsx, tests | Yes | 22.17.0 | — |
| `vitest` | test suite | Yes | 4.x (in package.json) | — |

**Missing dependencies with no fallback:** None.

---

## Validation Architecture

> `workflow.nyquist_validation` is absent from `.planning/config.json` — treated as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed in `vitest.config.ts`) |
| Config file | `vitest.config.ts` (exists at project root) |
| Quick run command | `pnpm test:run tests/unit/lib/asset-actions.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ASSET-01 | Upload dialog has description textarea; submit blocked when empty | unit | `pnpm test:run tests/unit/components/assets/` | No — Wave 0 |
| ASSET-02 | `createAsset` persists description to DB; nullable; existing assets unbroken | integration | `pnpm test:run tests/unit/lib/asset-actions.test.ts` | Yes (needs extension) |

**Notes:**
- `asset-actions.test.ts` already exists and covers `createAsset`. It must be extended to assert `description` is stored and retrieved correctly.
- A component test for `AssetUpload` is new (Wave 0 gap). It should verify: description textarea renders, submit is disabled when description is empty, submit is enabled when file + description are both present.
- Component tests run in jsdom (default vitest environment). No special env annotation needed.
- Action tests run in node environment (already annotated `// @vitest-environment node`).

### Sampling Rate
- **Per task commit:** `pnpm test:run tests/unit/lib/asset-actions.test.ts --reporter=dot`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/components/assets/asset-upload.test.tsx` — covers ASSET-01 (description textarea, submit guard)
- [ ] Extend `tests/unit/lib/asset-actions.test.ts` — covers ASSET-02 (description field persisted, null for legacy assets)

*(Existing `asset-actions.test.ts` covers the file but needs new test cases for the `description` field.)*

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Read Next.js guide in `node_modules/next/dist/docs/` before writing code** — AGENTS.md explicitly states breaking changes may exist.
- No `console.log` in production code.
- Use Zod for all server action input validation.
- Files under 800 lines; functions under 50 lines. (`i18n.tsx` is 574 lines; adding 4 keys keeps it well under 800.)
- No mutation — immutable patterns. (Textarea onChange uses `setDescription(e.target.value)` — returns new state, not mutation.)
- Test coverage minimum 80%. (Two new test coverage areas: `createAsset` with description, `AssetUpload` submit guard.)
- `file-utils.ts` and `fts.ts` must be zero-import from Next.js — not affected by this phase.
- FTS5 virtual table must be created AFTER `prisma db push` — `notes_fts` must survive this push; verify after.

---

## Sources

### Primary (HIGH confidence)
- `prisma/schema.prisma` (project file, read directly) — current `ProjectAsset` model, no `description` field
- `sqlite3 prisma/dev.db ".tables"` (live DB query, run directly) — confirms `notes_fts` exists, 1 asset row present
- `sqlite3 prisma/dev.db "PRAGMA table_info(ProjectAsset);"` (live DB query) — confirms `description` column does NOT yet exist
- `src/actions/asset-actions.ts` (project file, read directly) — current `createAssetSchema` and `uploadAsset` signatures
- `src/components/assets/asset-upload.tsx` (project file, read directly) — current dialog state and submit guard
- `src/components/assets/asset-item.tsx` (project file, read directly) — current `AssetItemType` interface
- `src/lib/i18n.tsx` (project file, read directly) — existing translation key pattern; all asset keys in both locales
- `.planning/STATE.md` (project file, read directly) — locked decisions including `description String? @default("")`
- `tests/unit/lib/asset-actions.test.ts` (project file, read directly) — existing test patterns

### Secondary (MEDIUM confidence)
- Phase 4 RESEARCH.md (`.planning/phases/04-data-layer-foundation/04-RESEARCH.md`) — established Prisma db push safety patterns, FTS5 table survival concern

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in project; no new dependencies
- Architecture: HIGH — all four files read directly; exact interface shapes verified; existing test patterns reviewed
- Pitfalls: HIGH — live DB query confirmed 1 existing asset row; FTS table survival concern documented in STATE.md Pending Todos; existing test file reviewed for impact

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (all dependencies project-locked; SQLite/Prisma versions stable)
