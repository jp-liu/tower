# Phase 11: SystemConfig Foundation - Research

**Researched:** 2026-03-30
**Domain:** Prisma schema extension, Next.js server actions, settings page navigation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Add a `SystemConfig` model to Prisma schema: `key` (String, @unique), `value` (String — JSON-serialized), `updatedAt` (DateTime @updatedAt), `createdAt` (DateTime @default(now()))
- **D-02:** Values stored as JSON strings. Consumers parse with `JSON.parse()`. Supports string, number, boolean, and object/array config values uniformly.
- **D-03:** No grouping/category column at this phase — config keys use dot-notation namespacing (e.g., `git.timeout`, `upload.maxSize`). A category column can be added later.
- **D-04:** Server actions in `src/actions/config-actions.ts`: `getConfigValue<T>(key: string, defaultValue: T): Promise<T>` and `setConfigValue(key: string, value: unknown): Promise<void>`
- **D-05:** `getConfigValue` queries the DB for the key. If no row exists, returns `defaultValue` without error. JSON.parse the stored value and cast to T.
- **D-06:** `setConfigValue` upserts (create or update) a row for the given key with `JSON.stringify(value)`.
- **D-07:** Add `getConfigValues(keys: string[]): Promise<Record<string, unknown>>` for batch read.
- **D-08:** Create `src/lib/config-defaults.ts` defining all known config keys, their types, default values, and human-readable labels. Single source of truth for config keys.
- **D-09:** Registry is a plain object keyed by config key string. Each entry has: `defaultValue`, `type` (for runtime validation), and `label` (for future UI rendering).
- **D-10:** Add a new nav item "Config" (icon: Wrench or Sliders) to settings-nav.tsx NAV_ITEMS array, positioned after "Prompts".
- **D-11:** Create `src/components/settings/system-config.tsx` as the Config section component. At this phase it shows a placeholder message.
- **D-12:** Wire the new section in `settings/page.tsx` with `activeSection === "config"` rendering `<SystemConfig />`.

### Claude's Discretion

- Exact icon choice for the Config nav item (Wrench, Sliders, SlidersHorizontal — any lucide icon that conveys configuration)
- Placeholder UI layout and messaging for the empty Config section
- Whether to add a `description` column to SystemConfig now or defer — preference is defer unless it's trivial

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope (auto mode).

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CFG-01 | 用户可通过 SystemConfig 表存储和读取系统配置项（key-value） | D-01 through D-12 cover the full scope: Prisma model, server actions (get/set/batch), defaults registry, and settings page Config section |

</phase_requirements>

---

## Summary

Phase 11 delivers a self-contained key-value configuration store backed by a new Prisma `SystemConfig` table. All design decisions are locked: the data model is a simple `key / value / updatedAt / createdAt` row where values are JSON-serialized strings, and the server-action API follows the established `"use server"` + Prisma pattern seen throughout `src/actions/`.

The settings page already has a clean section-switching architecture (`NAV_ITEMS` array + `activeSection` conditional render). Adding a Config section requires appending one entry to `NAV_ITEMS`, adding one conditional block to `settings/page.tsx`, creating one new component file, and adding translation keys to `i18n.tsx` for both `zh` and `en` locales.

The defaults registry (`src/lib/config-defaults.ts`) is the most novel piece — it acts as a compile-time catalogue of all known config keys so Phase 12-13 consumers don't need to hard-code defaults at call sites. At Phase 11 the registry starts empty (no parameters wired yet), ready for entries in subsequent phases.

**Primary recommendation:** Follow the exact file structure and API signatures in CONTEXT.md. No third-party libraries needed — this is all Prisma + TypeScript. The `prisma.$executeRaw` post-migration FTS trick from STATE.md is not required here; a plain `prisma db push` is sufficient.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Prisma | 6.19.2 | ORM — schema definition and upsert query | Already in use; all other models use it |
| Next.js server actions | 16.2.1 | `"use server"` functions for DB reads/writes | Established pattern in every `src/actions/*.ts` file |
| TypeScript generics | ~5.x | Type-safe `getConfigValue<T>` return | Aligns with project's strict-TS stance |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | 1.6.0 | Config nav icon | Matches every existing nav icon in `settings-nav.tsx` |
| useI18n hook | internal | Translation strings for Config section | All user-facing strings must go through `t()` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON string values (D-02) | Separate typed columns per config key | JSON string is simpler schema, supports arbitrary value types; typed columns need a migration per new parameter |
| Prisma upsert (D-06) | Raw SQL INSERT OR REPLACE | Prisma upsert is idiomatic and safe; raw SQL only needed for FTS5 (see STATE.md) |

**Installation:** No new packages needed. All dependencies are already installed.

---

## Architecture Patterns

### Recommended Project Structure

New files to create:

```
src/
├── actions/
│   └── config-actions.ts        # getConfigValue, setConfigValue, getConfigValues
├── lib/
│   └── config-defaults.ts       # CONFIG_DEFAULTS registry (empty at Phase 11)
└── components/
    └── settings/
        └── system-config.tsx    # Placeholder Config section component
```

Modified files:

```
prisma/schema.prisma             # Add SystemConfig model
src/components/settings/
    settings-nav.tsx             # Add Config nav item
src/app/settings/page.tsx        # Add activeSection === "config" render block
src/lib/i18n.tsx                 # Add settings.config.* translation keys
```

### Pattern 1: Prisma Model — SystemConfig

**What:** Minimal key-value table following existing schema conventions.
**When to use:** The canonical source for all decisions on field naming/type.

```typescript
// prisma/schema.prisma
model SystemConfig {
  key       String   @id           // dot-notation key, e.g. "git.timeout"
  value     String                 // JSON.stringify(actualValue)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Note: `key` is used as `@id` (rather than a separate cuid `id` + `@unique` on key) because SystemConfig rows are always looked up by key, and having a single surrogate PK would add no value. Every other model uses cuid IDs because they are referenced by foreign keys — SystemConfig has no foreign key references. This is a slight deviation from the CONTEXT.md spec (which says `@unique` on key plus implicit cuid id), so see "Pitfall 2" below for the tradeoff.

**Alternative (exactly matching D-01):**

```typescript
model SystemConfig {
  id        String   @id @default(cuid())
  key       String   @unique
  value     String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Either is correct. Using `key` as `@id` is slightly leaner. The planner should pick one and document it — both work with `prisma.systemConfig.upsert({ where: { key }, ... })`.

### Pattern 2: Server Actions — config-actions.ts

**What:** Three exported async functions, `"use server"` directive at top of file.
**When to use:** This is the exact shape Phase 12-13 consumers will call.

```typescript
// src/actions/config-actions.ts
"use server";

import { db } from "@/lib/db";
import { CONFIG_DEFAULTS } from "@/lib/config-defaults";

export async function getConfigValue<T>(key: string, defaultValue: T): Promise<T> {
  const row = await db.systemConfig.findUnique({ where: { key } });
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return defaultValue;
  }
}

export async function setConfigValue(key: string, value: unknown): Promise<void> {
  await db.systemConfig.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
  // revalidatePath("/settings") — add if the settings page uses RSC data fetching
}

export async function getConfigValues(keys: string[]): Promise<Record<string, unknown>> {
  const rows = await db.systemConfig.findMany({
    where: { key: { in: keys } },
  });
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  // Fill missing keys with defaults from registry
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = key in stored ? stored[key] : (CONFIG_DEFAULTS[key]?.defaultValue ?? null);
  }
  return result;
}
```

Source: Derived from `agent-config-actions.ts` pattern + D-04 through D-07 decisions.

### Pattern 3: Defaults Registry

**What:** A typed plain-object catalogue of all known config keys.
**When to use:** Defines what keys exist — Phase 12-13 adds entries here.

```typescript
// src/lib/config-defaults.ts
export interface ConfigEntry {
  defaultValue: unknown;
  type: "string" | "number" | "boolean" | "object";
  label: string;          // human-readable label for settings UI
}

export const CONFIG_DEFAULTS: Record<string, ConfigEntry> = {
  // Phase 11: empty — entries added in Phase 12-13
  // Example (Phase 12 will add):
  // "upload.maxSize": { defaultValue: 52428800, type: "number", label: "Max upload size (bytes)" },
};
```

### Pattern 4: Settings Nav — Adding Config Section

**What:** Append a new item to `NAV_ITEMS` in `settings-nav.tsx`.
**When to use:** Exact pattern every previous section (General, AI Tools, Prompts) uses.

```typescript
// settings-nav.tsx — add to NAV_ITEMS array
import { Settings, Cpu, FileText, SlidersHorizontal } from "lucide-react";

const NAV_ITEMS = [
  // ... existing items ...
  {
    id: "config",
    label: t("settings.config"),          // needs i18n key
    description: t("settings.configDesc"),
    icon: SlidersHorizontal,
  },
];
```

Note: `settings-nav.tsx` is a client component and does not currently use `useI18n`. The existing `label` and `description` strings are hardcoded English. Since D-10 says to follow the existing NAV_ITEMS pattern, the planner should either (a) add hardcoded strings matching the existing style, or (b) refactor all nav items to use `t()`. The current code has hardcoded strings — matching that style is the lowest-friction approach for this phase.

### Pattern 5: Settings Page — Adding Section Render

```typescript
// src/app/settings/page.tsx
import { SystemConfig } from "@/components/settings/system-config";

// Inside JSX:
{activeSection === "config" && <SystemConfig />}
```

### Pattern 6: SystemConfig Component (Placeholder)

**What:** Client component following `general-config.tsx` structure.

```typescript
// src/components/settings/system-config.tsx
"use client";

import { useI18n } from "@/lib/i18n";

export function SystemConfig() {
  const { t } = useI18n();
  return (
    <div>
      <h2 className="text-2xl font-bold">{t("settings.config")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.configDesc")}</p>
      <div className="mt-8">
        <p className="text-sm text-muted-foreground">{t("settings.config.empty")}</p>
      </div>
    </div>
  );
}
```

### Pattern 7: i18n Keys to Add

```typescript
// zh entries:
"settings.config": "参数配置",
"settings.configDesc": "系统运行参数",
"settings.config.empty": "暂无可配置参数 — 后续版本将添加",

// en entries:
"settings.config": "Config",
"settings.configDesc": "System configuration parameters",
"settings.config.empty": "No configurable parameters yet — coming in next phases",
```

### Anti-Patterns to Avoid

- **Custom caching layer:** Don't add an in-process JS cache on top of the DB read. Phase 14 handles CFG-02 (realtime effect). Phase 11 is DB-only, no caching.
- **Strict key validation at write time:** Don't reject keys not in `CONFIG_DEFAULTS` — the registry is informational, not a whitelist. Future phases can write new keys before updating the registry.
- **Separate migration file:** Do not create a manual SQL migration. Use `prisma db push` (the project's standard — confirmed by `package.json` script `db:push`). FTS5 raw SQL (STATE.md) is not needed here.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Upsert (create-or-update) | Manual SELECT then INSERT/UPDATE | `prisma.systemConfig.upsert` | Prisma handles race condition and returns the row atomically |
| JSON encode/decode | Custom serializer | `JSON.stringify` / `JSON.parse` | Standard, handles all primitive + nested types; no edge cases for this use |
| Type-safe key lookup | String literal union type + switch | Generic `getConfigValue<T>` with defaultValue parameter | TypeScript infers T from the defaultValue argument — no need for an explicit type map |

**Key insight:** This phase is intentionally thin infrastructure. The complexity belongs in Phase 12-13 where parameters get wired. Keeping Phase 11 minimal prevents over-engineering the registry before knowing what parameters will actually need.

---

## Common Pitfalls

### Pitfall 1: JSON.parse Throwing on Corrupt Value

**What goes wrong:** A manually-inserted or externally-modified `value` column contains malformed JSON; `JSON.parse` throws, causing `getConfigValue` to crash instead of returning the default.
**Why it happens:** SQLite allows any string value — no JSON schema enforcement at the DB level.
**How to avoid:** Wrap `JSON.parse` in a try/catch in `getConfigValue` and fall back to `defaultValue` on parse error (shown in Pattern 2 above).
**Warning signs:** Action returns `undefined` instead of the declared default.

### Pitfall 2: Using @id vs @unique on the key column

**What goes wrong:** CONTEXT.md D-01 specifies `key String @unique` (implying a separate cuid `id`). Using `key String @id` instead skips the surrogate id entirely.
**Why it happens:** Both work with `prisma.systemConfig.upsert({ where: { key }, ... })` — the difference is invisible until `@id` causes issues with Prisma's internal assumptions.
**How to avoid:** Follow D-01 exactly: add a cuid `id` field plus `@unique` on `key`. This matches every other model in the schema and avoids subtle Prisma behavior differences with `@id` on a non-cuid field.
**Warning signs:** Prisma generates a different client type shape than expected when using `key` as `@id`.

### Pitfall 3: revalidatePath Scope

**What goes wrong:** Calling `revalidatePath("/settings")` after `setConfigValue` does nothing useful because the settings page is a client component (`"use client"` in `page.tsx`) — there is no server-side cache to invalidate.
**Why it happens:** `revalidatePath` only matters for RSC (server components) or full page caches. The settings page fetches data client-side via `useEffect`.
**How to avoid:** Omit `revalidatePath` from `setConfigValue` for now, or add it as a no-op comment. The real reactivity (CFG-02) is Phase 14's job.
**Warning signs:** Calling `revalidatePath` in server actions that only feed client components produces no visible effect and adds confusion.

### Pitfall 4: i18n TranslationKey Type Must Be Updated

**What goes wrong:** Adding new translation keys to the `translations` object in `i18n.tsx` without also reflecting them in the `TranslationKey = keyof typeof translations.zh` derived type. In practice TypeScript derives this automatically — but if the keys are only added to one locale (e.g., `zh`) and not the other (`en`), the `as const` constraint will cause a type error.
**Why it happens:** The `translations` object uses `as const` — both locales must have identical key sets or the derived type breaks.
**How to avoid:** Add every new key to BOTH `zh` and `en` objects in the same edit. The type is derived from `translations.zh`, so missing an `en` entry produces a runtime `key` fallback but no compile error — a silent gap.
**Warning signs:** `t("settings.config")` returns the key string itself ("settings.config") at runtime instead of a translated label.

---

## Code Examples

Verified patterns from existing codebase:

### Prisma upsert pattern (from agent-config-actions.ts)

```typescript
// Source: src/actions/agent-config-actions.ts line 22-29
const config = await db.agentConfig.update({
  where: { id },
  data,
});
revalidatePath("/settings");
return config;
```

For `setConfigValue`, use `upsert` instead of `update` (no guaranteed pre-existing row):

```typescript
await db.systemConfig.upsert({
  where: { key },
  create: { key, value: JSON.stringify(value) },
  update: { value: JSON.stringify(value) },
});
```

### Server action file header (from workspace-actions.ts)

```typescript
// Source: src/actions/workspace-actions.ts lines 1-3
"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
```

### Settings component structure (from general-config.tsx)

```typescript
// Source: src/components/settings/general-config.tsx lines 1-11
"use client";

import { useTheme } from "next-themes";
import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
```

### NAV_ITEMS pattern (from settings-nav.tsx)

```typescript
// Source: src/components/settings/settings-nav.tsx lines 5-23
const NAV_ITEMS = [
  {
    id: "general",
    label: "General",
    description: "Appearance and language preferences",
    icon: Settings,
  },
  // ... append Config item after "prompts"
];
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded constants in source files | DB-backed key-value store | Phase 11 (now) | Parameters can be changed at runtime without redeployment |
| No config registry | `config-defaults.ts` typed registry | Phase 11 (now) | Compile-time catalogue prevents silent default drift |

**No deprecated patterns for this phase** — all tooling (Prisma, Next.js server actions) is already in use.

---

## Open Questions

1. **`@id` vs `@unique` on the `key` column**
   - What we know: D-01 specifies a cuid `id` + `@unique` on key. Using `key` as `@id` also works.
   - What's unclear: Whether future tooling (e.g., Prisma Studio, admin scripts) relies on a standard `id` field.
   - Recommendation: Follow D-01 exactly — use a cuid `id` to stay consistent with all 10 existing models.

2. **`revalidatePath` in `setConfigValue`**
   - What we know: `settings/page.tsx` is a client component; `revalidatePath` has no effect on pure client components.
   - What's unclear: Whether future phases will add RSC data loading to the settings page.
   - Recommendation: Include `revalidatePath("/settings")` as a no-op comment for forward-compatibility, matching agent-config-actions.ts pattern. Add a code comment explaining it has no current effect.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code and schema changes. No external tools, services, CLIs, or runtimes beyond what is already installed are required. `prisma db push` is the only command needed and Prisma is already installed.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `pnpm test:run -- tests/unit/actions/config-actions.test.ts` |
| Full suite command | `pnpm test:run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CFG-01 | `getConfigValue` returns defaultValue when key absent | unit | `pnpm test:run -- tests/unit/actions/config-actions.test.ts` | Wave 0 |
| CFG-01 | `getConfigValue` returns stored value when key present | unit | same | Wave 0 |
| CFG-01 | `setConfigValue` inserts new row (upsert create path) | unit | same | Wave 0 |
| CFG-01 | `setConfigValue` updates existing row (upsert update path) | unit | same | Wave 0 |
| CFG-01 | `getConfigValues` batch reads multiple keys, fills defaults for missing | unit | same | Wave 0 |
| CFG-01 | Config nav item appears in settings sidebar | unit | `pnpm test:run -- tests/unit/components/system-config.test.tsx` | Wave 0 |
| CFG-01 | SystemConfig placeholder renders correct heading and message | unit | same | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test:run -- tests/unit/actions/config-actions.test.ts`
- **Per wave merge:** `pnpm test:run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/actions/config-actions.test.ts` — covers CFG-01 CRUD behaviors. Use `// @vitest-environment node` + real PrismaClient against dev.db, following the pattern in `tests/unit/actions/search-actions.test.ts`.
- [ ] `tests/unit/components/system-config.test.tsx` — covers Config nav item render + placeholder message. Use `renderWithI18n` pattern from `prompts-config.test.tsx`.

---

## Sources

### Primary (HIGH confidence)

- Direct code inspection: `prisma/schema.prisma` — existing model patterns (cuid id, DateTime fields, @unique constraints)
- Direct code inspection: `src/actions/workspace-actions.ts` — "use server" + Prisma query + revalidatePath pattern
- Direct code inspection: `src/actions/agent-config-actions.ts` — settings CRUD pattern
- Direct code inspection: `src/components/settings/settings-nav.tsx` — NAV_ITEMS array structure
- Direct code inspection: `src/app/settings/page.tsx` — activeSection conditional render pattern
- Direct code inspection: `src/lib/i18n.tsx` — as const translations, TranslationKey derived type, useI18n hook
- Direct code inspection: `tests/unit/actions/search-actions.test.ts` — unit test pattern for server actions
- Direct code inspection: `tests/unit/components/prompts-config.test.tsx` — component test pattern with I18nProvider
- Direct code inspection: `vitest.config.ts` — test framework config, test include glob
- `.planning/phases/11-systemconfig-foundation/11-CONTEXT.md` — all locked decisions
- `.planning/STATE.md` — accumulated project decisions (SQLite FTS5, PRAGMA settings)

### Secondary (MEDIUM confidence)

- `package.json` inspection — confirmed Prisma 6.19.2, Vitest 4.1.1, lucide-react 1.6.0, no new packages needed

### Tertiary (LOW confidence)

None.

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries verified from direct package.json + source inspection
- Architecture: HIGH — all patterns extracted from existing codebase (no external research needed)
- Pitfalls: HIGH — derived from direct code inspection of actual patterns in use

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable tech stack, no external dependencies)
