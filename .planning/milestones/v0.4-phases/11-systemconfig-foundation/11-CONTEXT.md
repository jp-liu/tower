# Phase 11: SystemConfig Foundation - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Mode:** auto (all gray areas auto-resolved with recommended defaults)

<domain>
## Phase Boundary

Persistent config store with key-value read/write API, and a settings page Config section ready to host parameter controls. This phase delivers the infrastructure — actual parameter wiring (upload limits, Git timeouts, etc.) happens in Phase 12-13.

</domain>

<decisions>
## Implementation Decisions

### Config Data Model
- **D-01:** Add a `SystemConfig` model to Prisma schema: `key` (String, @unique), `value` (String — JSON-serialized), `updatedAt` (DateTime @updatedAt), `createdAt` (DateTime @default(now()))
- **D-02:** Values stored as JSON strings. Consumers parse with `JSON.parse()`. This supports string, number, boolean, and object/array config values uniformly.
- **D-03:** No grouping/category column at this phase — config keys use dot-notation namespacing (e.g., `git.timeout`, `upload.maxSize`) for logical grouping. A category column can be added later if the settings UI needs it.

### Config API Design
- **D-04:** Server actions in `src/actions/config-actions.ts`: `getConfigValue<T>(key: string, defaultValue: T): Promise<T>` and `setConfigValue(key: string, value: unknown): Promise<void>`
- **D-05:** `getConfigValue` queries the DB for the key. If no row exists, returns `defaultValue` without error. JSON.parse the stored value and cast to T.
- **D-06:** `setConfigValue` upserts (create or update) a row for the given key with `JSON.stringify(value)`.
- **D-07:** Add a batch read function `getConfigValues(keys: string[]): Promise<Record<string, unknown>>` for cases where the UI needs to load multiple config values at once (reduces DB round-trips).

### Default Config Registry
- **D-08:** Create `src/lib/config-defaults.ts` defining all known config keys, their types, default values, and human-readable labels. This is the single source of truth for what config keys exist and what their defaults are.
- **D-09:** The registry is a plain object keyed by config key string. Each entry has: `defaultValue`, `type` (for runtime validation), and `label` (for future UI rendering). Phase 12-13 will add entries as they wire parameters.

### Settings Page Integration
- **D-10:** Add a new nav item "Config" (icon: Wrench or Sliders) to settings-nav.tsx NAV_ITEMS array, positioned after "Prompts".
- **D-11:** Create `src/components/settings/system-config.tsx` as the Config section component. At this phase it shows a placeholder message ("No configurable parameters yet — coming in next phases") since actual parameter UI is Phase 12-13's job.
- **D-12:** Wire the new section in `settings/page.tsx` with `activeSection === "config"` rendering `<SystemConfig />`.

### Claude's Discretion
- Exact icon choice for the Config nav item (Wrench, Sliders, SlidersHorizontal — any lucide icon that conveys configuration)
- Placeholder UI layout and messaging for the empty Config section
- Whether to add a `description` column to SystemConfig now or defer — preference is defer unless it's trivial

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Database Schema
- `prisma/schema.prisma` — Current schema (10 models, 6 enums). New SystemConfig model must follow existing patterns (cuid id, DateTime fields)

### Settings Page
- `src/app/settings/page.tsx` — Settings page with activeSection routing (General, AI Tools, Prompts)
- `src/components/settings/settings-nav.tsx` — NAV_ITEMS array pattern for adding new nav items
- `src/components/settings/general-config.tsx` — Example of a settings section component (theme/language toggles)

### Server Actions Pattern
- `src/actions/workspace-actions.ts` — "use server" pattern, Prisma queries, revalidatePath
- `src/actions/agent-config-actions.ts` — Existing config CRUD pattern (AgentConfig model)

### i18n
- `src/lib/i18n.tsx` — All user-facing strings must use t() calls. New translation keys needed for Config section.

### Requirements
- `.planning/REQUIREMENTS.md` — CFG-01 is the target requirement for this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `settings-nav.tsx` NAV_ITEMS array: Simple push to add new section — icon + id + label + description
- `settings/page.tsx` activeSection pattern: Just add a new conditional render block
- `AgentConfig` model: Existing key-value-ish pattern in Prisma (agent + configName + settings as JSON string)
- `src/lib/db.ts`: Singleton PrismaClient — use for config queries
- `useI18n()` hook: Translation support ready for new keys

### Established Patterns
- Server actions: `"use server"` directive, plain object params, return Prisma models, revalidatePath after mutations
- Settings components: Client components with `"use client"`, useI18n for translations, Tailwind utility classes
- Prisma schema: cuid IDs, DateTime fields with @default(now()) and @updatedAt, @unique constraints

### Integration Points
- `prisma/schema.prisma`: Add SystemConfig model
- `src/actions/config-actions.ts`: New server actions file
- `src/lib/config-defaults.ts`: New defaults registry
- `src/components/settings/settings-nav.tsx`: Add Config nav item
- `src/components/settings/system-config.tsx`: New Config section component
- `src/app/settings/page.tsx`: Wire new section
- `src/lib/i18n.tsx`: Add translation keys for Config section

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for key-value config infrastructure.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (auto mode).

</deferred>

---

*Phase: 11-systemconfig-foundation*
*Context gathered: 2026-03-30*
