# Phase 12: Git Path Mapping Rules - Research

**Researched:** 2026-03-30
**Domain:** Next.js 16 settings UI + server actions + pure TypeScript logic
**Confidence:** HIGH

## Summary

Phase 12 builds a settings UI for managing Git path mapping rules and wires those rules into the project-creation flow. Every decision is already locked in CONTEXT.md — no alternative research is needed. The implementation is purely additive: a new `GitPathRule` type, a `matchGitPathRule` function, a `resolveGitLocalPath` server action, an entry in `CONFIG_DEFAULTS`, and a replacement for the placeholder `SystemConfig` component. No Prisma migrations, no new packages.

The existing codebase provides all necessary patterns. `PromptsConfig` demonstrates the full CRUD settings panel lifecycle (load on mount, Dialog for create/edit, confirmation Dialog for delete, optimistic state update after save). The only novel element is the inline-row-edit UI (D-10), which PromptsConfig does not do — it uses a Dialog. Inline editing follows standard React controlled-input patterns and requires no third-party library.

The only architectural nuance that needs care is the `handleGitUrlChange` async migration in `top-bar.tsx`. That callback is currently synchronous; making it async requires ensuring no race condition between fast typing and the server action call. A guard (`localPathManual` flag already exists) prevents overwriting manual edits.

**Primary recommendation:** Implement in four tightly-scoped plans: (1) data model + matching logic, (2) `resolveGitLocalPath` server action + `top-bar.tsx` integration, (3) `system-config.tsx` rules UI, (4) i18n keys and test coverage.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Rule Data Model**
- D-01: Store rules as a JSON array in SystemConfig with key `git.pathMappingRules`. No new Prisma model.
- D-02: Each rule: `{ id: string, host: string, ownerMatch: string, localPathTemplate: string, priority: number }`. `id` is a cuid for client-side keying. `ownerMatch` is a prefix match. `localPathTemplate` supports `{owner}` and `{repo}` interpolation.
- D-03: Register `git.pathMappingRules` in `config-defaults.ts` with `defaultValue: []`. Current hardcoded rules become seed examples only.
- D-04: Read/write via existing `getConfigValue<GitPathRule[]>` / `setConfigValue` in `config-actions.ts`.

**Rule Matching Logic**
- D-05: New function `matchGitPathRule(url: string, rules: GitPathRule[]): string` in `git-url.ts`. Sort by priority (lower = higher priority), first match returns interpolated `localPathTemplate`, no match returns `""`.
- D-06: `ownerMatch` exact match by default. Wildcard `*` matches any owner for that host.
- D-07: Existing `gitUrlToLocalPath` becomes async. Reads rules from DB via `getConfigValue`, tries `matchGitPathRule` first, falls back to existing hardcoded logic if no match.

**Settings UI Design**
- D-08: Replace placeholder in `system-config.tsx` with a Git Path Mapping Rules section. Table/list with columns: Host, Owner Match, Local Path Template, actions (edit/delete).
- D-09: "Add Rule" button opens an inline form (not a Dialog) below the table. Fields: Host, Owner Match (placeholder `*`), Local Path Template (placeholder `~/project/{repo}`), Priority (number, default 0).
- D-10: Edit is inline — clicking edit on a row converts it to editable inputs. Save/Cancel buttons. Delete shows a confirmation.
- D-11: All UI strings use `t()` i18n calls. New translation keys under `settings.config.git.*` namespace.

**Auto-populate Integration**
- D-12: In `top-bar.tsx`, `handleGitUrlChange` calls updated async `gitUrlToLocalPath`. Needs to call a server action (client component cannot call server-side DB directly).
- D-13: New server action `resolveGitLocalPath(url: string): Promise<string>` in `config-actions.ts`. Loads rules from DB, calls `matchGitPathRule`. Falls back to hardcoded logic if no match.
- D-14: `handleGitUrlChange` in `top-bar.tsx` becomes async: `const path = await resolveGitLocalPath(value); setLocalPath(path);`

### Claude's Discretion
- Exact table styling and layout details for the rules list
- Validation messages for invalid template patterns
- Whether to show a "test" button that previews what a sample URL would resolve to
- Transition animation when adding/editing rules

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope (auto mode).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GIT-01 | User can add, edit, delete Git path mapping rules (host + owner → localPath template) from settings page | D-08 through D-11 locked. `system-config.tsx` placeholder is the target component. Inline CRUD pattern verified viable. |
| GIT-02 | When creating a project and entering a Git URL, the localPath field auto-populates by matching against user-defined rules | D-12 through D-14 locked. `top-bar.tsx` line 74-76 is the exact integration point. `resolveGitLocalPath` server action bridges client→DB. |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- This project uses **Next.js 16.2.1** — check `node_modules/next/dist/docs/` for breaking changes before writing any code.
- No `console.log` in production code (TypeScript hooks enforce this).
- Immutable patterns: always spread to create new objects, never mutate.
- Functions < 50 lines. Files < 800 lines.
- Error handling at every level with user-friendly messages in UI-facing code.
- All user input validated. `zod` is available in the project (`"zod": "^4.3.6"`).
- 80%+ test coverage target. TDD: write test first (RED), implement (GREEN), refactor.
- Follow TypeScript coding style: async/await with try-catch.
- No hardcoded secrets or values — use constants or config.

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.2.1 | Framework | Project baseline |
| React | 19.2.4 | UI | Project baseline |
| Prisma | ^6.19.2 | DB access | Project baseline (SystemConfig model exists) |
| lucide-react | ^1.6.0 | Icons | Already used throughout settings |
| zod | ^4.3.6 | Input validation | Already in package.json, project rule |
| vitest | ^4.1.1 | Unit tests | `vitest.config.ts` present, `tests/` dir established |

### No New Packages Required

All building blocks exist. No `npm install` step.

**Client-side ID generation for rule objects:** Use `crypto.randomUUID()` — available natively in all modern browsers and Node.js 22. No cuid2 package needed. (The project has no cuid utility outside of Prisma's `@default(cuid())`, and no `@paralleldrive/cuid2` in `package.json`.)

---

## Architecture Patterns

### Recommended File Layout for This Phase

```
src/
├── lib/
│   ├── git-url.ts              # Add GitPathRule type, matchGitPathRule(), modify gitUrlToLocalPath() → async
│   └── config-defaults.ts     # Add git.pathMappingRules entry
├── actions/
│   └── config-actions.ts      # Add resolveGitLocalPath() server action
├── components/
│   └── settings/
│       └── system-config.tsx   # Replace placeholder with full Git rules CRUD UI
└── lib/
    └── i18n.tsx                # Add settings.config.git.* translation keys
tests/
└── unit/
    ├── lib/
    │   └── git-url.test.ts     # New: unit tests for matchGitPathRule
    └── actions/
        └── config-actions.test.ts  # Extend with resolveGitLocalPath tests
```

### Pattern 1: GitPathRule Type (in `git-url.ts`)

```typescript
// src/lib/git-url.ts — add near top
export interface GitPathRule {
  id: string;
  host: string;
  ownerMatch: string;       // exact owner, or "*" for any
  localPathTemplate: string; // supports {owner} and {repo}
  priority: number;          // lower number = higher priority
}
```

### Pattern 2: matchGitPathRule Pure Function

```typescript
// Source: project decision D-05, D-06
export function matchGitPathRule(url: string, rules: GitPathRule[]): string {
  const parsed = parseGitUrl(url.trim());
  if (!parsed) return "";

  const { host, pathSegments } = parsed;
  const owner = pathSegments[0] ?? "";
  const repo = pathSegments[pathSegments.length - 1] ?? "";

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (rule.host !== host) continue;
    if (rule.ownerMatch !== "*" && rule.ownerMatch !== owner) continue;
    return expandHome(
      rule.localPathTemplate
        .replace("{owner}", owner)
        .replace("{repo}", repo)
    );
  }
  return "";
}
```

### Pattern 3: gitUrlToLocalPath Becomes Async (server-side only)

The existing function is called only from `top-bar.tsx` via `handleGitUrlChange`. With D-07, it becomes a thin wrapper used internally by `resolveGitLocalPath`. The original sync export can be kept for any non-async callers or deprecated with a comment.

```typescript
// Internal async version (used by resolveGitLocalPath)
async function gitUrlToLocalPathAsync(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return "";
  const rules = await getConfigValue<GitPathRule[]>("git.pathMappingRules", []);
  const matched = matchGitPathRule(trimmed, rules);
  if (matched) return matched;
  return gitUrlToLocalPath(trimmed); // fallback to existing sync logic
}
```

**Important:** `git-url.ts` currently has no imports from Next.js and must stay that way (project constraint from STATE.md: `file-utils.ts and fts.ts must never import Next.js modules`). However, importing `getConfigValue` from `config-actions.ts` would add a "use server" dependency. This means `matchGitPathRule` stays pure in `git-url.ts`, and the async DB read lives entirely in `resolveGitLocalPath` inside `config-actions.ts`.

### Pattern 4: resolveGitLocalPath Server Action

```typescript
// src/actions/config-actions.ts — append
import { matchGitPathRule, gitUrlToLocalPath, type GitPathRule } from "@/lib/git-url";

export async function resolveGitLocalPath(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const rules = await getConfigValue<GitPathRule[]>("git.pathMappingRules", []);
    const matched = matchGitPathRule(trimmed, rules);
    if (matched) return matched;
    return gitUrlToLocalPath(trimmed); // sync fallback
  } catch {
    return gitUrlToLocalPath(trimmed);
  }
}
```

### Pattern 5: top-bar.tsx handleGitUrlChange Async Migration

```typescript
// src/components/layout/top-bar.tsx — modify handleGitUrlChange
import { resolveGitLocalPath } from "@/actions/config-actions";

const handleGitUrlChange = async (value: string) => {
  setGitUrl(value);
  setCloneStatus("idle");
  setCloneError("");
  if (!localPathManual) {
    const path = await resolveGitLocalPath(value);
    setLocalPath(path);
  }
};
```

**Note:** The `localPathManual` guard already prevents overwriting user-entered values. No debounce is needed for correctness — the server action is idempotent and fast (single DB read). However, rapid typing may issue multiple concurrent calls; since each call sets `localPath` independently, the last-write-wins behavior is acceptable (URL is deterministic for the same input).

### Pattern 6: CONFIG_DEFAULTS Entry

```typescript
// src/lib/config-defaults.ts
export const CONFIG_DEFAULTS: Record<string, ConfigEntry> = {
  "git.pathMappingRules": {
    defaultValue: [],
    type: "object",
    label: "Git Path Mapping Rules",
  },
};
```

### Pattern 7: Inline CRUD UI (system-config.tsx replacement)

The component follows the `PromptsConfig` structure but with inline row editing (D-10) instead of Dialogs for edit. State shape:

```typescript
type RuleEditState = {
  host: string;
  ownerMatch: string;
  localPathTemplate: string;
  priority: number;
};

// Component state
const [rules, setRules] = useState<GitPathRule[]>([]);
const [editingId, setEditingId] = useState<string | null>(null); // null = no row editing
const [editForm, setEditForm] = useState<RuleEditState>({ ... });
const [showAddForm, setShowAddForm] = useState(false);
const [addForm, setAddForm] = useState<RuleEditState>({ ... });
const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
```

Load pattern (same as PromptsConfig):
```typescript
useEffect(() => {
  getConfigValue<GitPathRule[]>("git.pathMappingRules", []).then(setRules);
}, []);
```

Save pattern (write full array back):
```typescript
const handleSaveRule = async (updated: GitPathRule[]) => {
  await setConfigValue("git.pathMappingRules", updated);
  setRules(updated);
};
```

### Anti-Patterns to Avoid

- **Importing `config-actions.ts` from `git-url.ts`:** This would import a `"use server"` module into a pure library file. Keep `matchGitPathRule` pure and stateless in `git-url.ts`. All DB access goes through `config-actions.ts`.
- **Adding a new Prisma model for rules:** D-01 locks this out. Rules are a JSON array in `SystemConfig`.
- **Mutating the rules array in state:** Always spread: `[...rules, newRule]`, `rules.map(r => r.id === id ? updated : r)`, `rules.filter(r => r.id !== id)`.
- **Using Dialog for edit (PromptsConfig pattern):** D-10 specifies inline row editing, not a Dialog. This diverges from PromptsConfig deliberately.
- **Debouncing handleGitUrlChange for correctness:** The `localPathManual` guard is the correct mechanism; debouncing would add complexity without benefit.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Template interpolation `{owner}`, `{repo}` | Custom template engine | Simple `String.replace()` | Only 2 tokens, no nesting or escaping required |
| Client-side ID for new rules | Custom hash function | `crypto.randomUUID()` | Native browser/Node API, no collision risk |
| JSON serialization of rules | Custom serializer | `JSON.stringify` / `JSON.parse` via existing `setConfigValue`/`getConfigValue` | Already battle-tested by Phase 11 |
| Form state management | Formik/react-hook-form | Local `useState` | Established project pattern (PromptsConfig, top-bar.tsx); no form library in package.json |

---

## Common Pitfalls

### Pitfall 1: git-url.ts Import Contamination

**What goes wrong:** Developer imports `getConfigValue` directly in `git-url.ts` to make `gitUrlToLocalPath` async inline.
**Why it happens:** Seems like the natural place since the function is already there.
**How to avoid:** Keep `git-url.ts` free of Next.js/server imports (project-wide rule). All DB reads stay in `config-actions.ts`. `matchGitPathRule` takes the rules array as a parameter — it does not fetch them.
**Warning signs:** `import from "@/actions/config-actions"` appearing in `git-url.ts`.

### Pitfall 2: Async handleGitUrlChange Breaking Input Feel

**What goes wrong:** `handleGitUrlChange` awaits the server action before updating `gitUrl` state, making the input feel laggy.
**Why it happens:** Putting the `await` before `setGitUrl(value)`.
**How to avoid:** Call `setGitUrl(value)`, `setCloneStatus("idle")`, and `setCloneError("")` synchronously first. Only the `setLocalPath` call is async.
**Warning signs:** Input visually lags when typing in the Git URL field.

### Pitfall 3: Priority Sorting Mutation

**What goes wrong:** `rules.sort(...)` mutates the array in place, causing unexpected React re-renders or stale state.
**Why it happens:** `Array.sort()` mutates in JavaScript.
**How to avoid:** Use `[...rules].sort(...)` in `matchGitPathRule`. This is already shown in the code example above.
**Warning signs:** Rules reorder visually in the UI without user action.

### Pitfall 4: i18n Type Error from Missing Translation Keys

**What goes wrong:** `t("settings.config.git.someKey")` causes a TypeScript compile error because `TranslationKey` is derived from `typeof translations.zh` and the key doesn't exist yet.
**Why it happens:** `i18n.tsx` uses `type TranslationKey = keyof typeof translations.zh` — it's a strict union type.
**How to avoid:** Add ALL new keys to BOTH `zh` and `en` sections of `i18n.tsx` before using them in the component. The TypeScript compiler will catch any key used in `t()` that isn't declared.
**Warning signs:** `Argument of type '"settings.config.git.xxx"' is not assignable to parameter of type 'TranslationKey'`.

### Pitfall 5: Stale Rules State After Save

**What goes wrong:** After saving rules, the UI shows old data because state wasn't updated.
**Why it happens:** Only calling `setConfigValue` without updating local React state.
**How to avoid:** After every write (`handleSaveRule`), update `rules` state directly from the computed new array — don't re-fetch from DB (no reactivity in Phase 12, CFG-02 is Phase 14).
**Warning signs:** Rules disappear or revert after clicking Save.

### Pitfall 6: ownerMatch Wildcard Ordering

**What goes wrong:** Wildcard rule `*` matches before specific owner rules because of insertion order.
**Why it happens:** Not sorting by priority before matching.
**How to avoid:** Ensure `matchGitPathRule` sorts by `priority` ascending before iterating. Specific rules should have lower priority numbers than catch-all rules.
**Warning signs:** Specific owner rules are ignored in favor of wildcard rules.

---

## Code Examples

### Full matchGitPathRule with wildcard + priority

```typescript
// Source: project decisions D-05, D-06 — verified against git-url.ts parseGitUrl internals
export function matchGitPathRule(url: string, rules: GitPathRule[]): string {
  if (!rules.length) return "";
  const trimmed = url.trim();
  const parsed = parseGitUrl(trimmed);
  if (!parsed) return "";

  const { host, pathSegments } = parsed;
  const owner = pathSegments[0] ?? "";
  const repo = pathSegments[pathSegments.length - 1] ?? "";

  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (rule.host !== host) continue;
    if (rule.ownerMatch !== "*" && rule.ownerMatch !== owner) continue;
    const result = rule.localPathTemplate
      .replace("{owner}", owner)
      .replace("{repo}", repo);
    return expandHome(result);
  }
  return "";
}
```

### handleGitUrlChange async migration (top-bar.tsx)

```typescript
// Source: project decision D-14
// Change: was synchronous, now async. setGitUrl fires synchronously, setLocalPath is async.
const handleGitUrlChange = async (value: string) => {
  setGitUrl(value);
  setCloneStatus("idle");
  setCloneError("");
  if (!localPathManual) {
    const path = await resolveGitLocalPath(value);
    setLocalPath(path);
  }
};
```

### Inline row edit toggle pattern

```typescript
// Source: established React controlled-input pattern (no existing example in codebase)
const handleEditStart = (rule: GitPathRule) => {
  setEditingId(rule.id);
  setEditForm({
    host: rule.host,
    ownerMatch: rule.ownerMatch,
    localPathTemplate: rule.localPathTemplate,
    priority: rule.priority,
  });
};

const handleEditSave = async (ruleId: string) => {
  const updated = rules.map((r) =>
    r.id === ruleId ? { ...r, ...editForm } : r
  );
  await setConfigValue("git.pathMappingRules", updated);
  setRules(updated);
  setEditingId(null);
};

const handleEditCancel = () => {
  setEditingId(null);
};
```

### Add rule pattern

```typescript
// Source: immutability pattern from project rules
const handleAddRule = async () => {
  const newRule: GitPathRule = {
    id: crypto.randomUUID(),
    host: addForm.host.trim(),
    ownerMatch: addForm.ownerMatch.trim() || "*",
    localPathTemplate: addForm.localPathTemplate.trim(),
    priority: addForm.priority,
  };
  const updated = [...rules, newRule];
  await setConfigValue("git.pathMappingRules", updated);
  setRules(updated);
  setShowAddForm(false);
  setAddForm({ host: "", ownerMatch: "*", localPathTemplate: "", priority: 0 });
};
```

### Delete rule pattern

```typescript
// Source: immutability pattern + existing prompts-config delete pattern
const handleDeleteRule = async (ruleId: string) => {
  const updated = rules.filter((r) => r.id !== ruleId);
  await setConfigValue("git.pathMappingRules", updated);
  setRules(updated);
  setDeleteConfirmId(null);
};
```

---

## Validation Architecture

`workflow.nyquist_validation` is absent from `.planning/config.json` — treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.1 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run tests/unit/lib/git-url.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GIT-01 | Rules persist to DB (add/edit/delete round-trips) | integration | `npx vitest run tests/unit/actions/config-actions.test.ts` | Extend existing |
| GIT-01 | UI renders rules list | unit (component) | `npx vitest run tests/unit/components/system-config.test.tsx` | ❌ Wave 0 |
| GIT-02 | matchGitPathRule: exact owner match | unit | `npx vitest run tests/unit/lib/git-url.test.ts` | ❌ Wave 0 |
| GIT-02 | matchGitPathRule: wildcard `*` match | unit | `npx vitest run tests/unit/lib/git-url.test.ts` | ❌ Wave 0 |
| GIT-02 | matchGitPathRule: priority ordering | unit | `npx vitest run tests/unit/lib/git-url.test.ts` | ❌ Wave 0 |
| GIT-02 | matchGitPathRule: no match returns `""` | unit | `npx vitest run tests/unit/lib/git-url.test.ts` | ❌ Wave 0 |
| GIT-02 | matchGitPathRule: `{owner}` and `{repo}` interpolation | unit | `npx vitest run tests/unit/lib/git-url.test.ts` | ❌ Wave 0 |
| GIT-02 | resolveGitLocalPath: uses rules when present | integration | `npx vitest run tests/unit/actions/config-actions.test.ts` | Extend existing |
| GIT-02 | resolveGitLocalPath: falls back to hardcoded logic when no rules | integration | `npx vitest run tests/unit/actions/config-actions.test.ts` | Extend existing |

### Sampling Rate

- **Per task commit:** `npx vitest run tests/unit/lib/git-url.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/lib/git-url.test.ts` — unit tests for `matchGitPathRule` (all cases above)
- [ ] `tests/unit/components/system-config.test.tsx` — component smoke test (renders section heading, add button visible)

*(Extending `tests/unit/actions/config-actions.test.ts` covers integration — that file already exists.)*

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — purely code and config changes, all tools already installed).

---

## Sources

### Primary (HIGH confidence)

All findings derived from direct code inspection of the project source:

- `src/lib/git-url.ts` — Full source of current sync `gitUrlToLocalPath`, `parseGitUrl`, `expandHome`
- `src/actions/config-actions.ts` — `getConfigValue`, `setConfigValue`, `getConfigValues` exact signatures
- `src/lib/config-defaults.ts` — Current empty CONFIG_DEFAULTS registry
- `src/components/settings/system-config.tsx` — Placeholder component to be replaced
- `src/components/layout/top-bar.tsx` — `handleGitUrlChange` at line 70-77 (current sync call)
- `src/components/settings/prompts-config.tsx` — CRUD settings panel reference pattern
- `src/lib/i18n.tsx` — Translation key type system (`keyof typeof translations.zh`)
- `src/app/settings/page.tsx` — Settings page wiring (no changes needed here)
- `prisma/schema.prisma` — `SystemConfig` model confirmed present
- `package.json` — Verified: no cuid2 package, `crypto.randomUUID()` is the right approach
- `vitest.config.ts` — Test framework configuration
- `tests/unit/actions/config-actions.test.ts` — Existing test pattern to extend

### Secondary (MEDIUM confidence)

- Phase 12 CONTEXT.md — All decisions locked (D-01 through D-14)
- `.planning/STATE.md` — Project-wide decisions and constraints

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages inspected in `package.json`, no new installs needed
- Architecture: HIGH — all canonical files read directly, patterns confirmed
- Pitfalls: HIGH — derived from code analysis of actual integration points
- Test gaps: HIGH — `vitest.config.ts` and all existing test files inspected

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable dependencies, locked decisions)
