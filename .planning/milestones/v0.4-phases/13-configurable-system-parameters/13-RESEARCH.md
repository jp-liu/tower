# Phase 13: Configurable System Parameters - Research

**Researched:** 2026-03-30
**Domain:** Next.js config wiring — replacing hardcoded values with SystemConfig DB reads across server actions, server-side modules, and client components
**Confidence:** HIGH

## Summary

Phase 13 is a pure wiring phase. The config infrastructure (SystemConfig table, `getConfigValue`/`setConfigValue`/`getConfigValues` server actions, `CONFIG_DEFAULTS` registry) is fully built in Phase 11 and verified working. Phase 12 demonstrated the full settings-UI pattern. This phase registers 8 new config keys and routes each hardcoded constant through `getConfigValue`, then adds three new sections to `system-config.tsx`.

The two non-trivial challenges are: (1) `canStartExecution()` in `process-manager.ts` is synchronous — making it async requires tracing all call sites to ensure they `await`; and (2) the branch template in `task-detail-panel.tsx` is a client component reading a server-only value, requiring a dedicated server action to surface the template on mount.

All other consumer sites are server-side, making `getConfigValue` a straightforward drop-in replacement with no architectural concerns.

**Primary recommendation:** Implement in four waves — (1) config registry + utility function, (2) server-side consumer wiring, (3) client-side consumer wiring, (4) settings UI sections. This separates infrastructure from UI and allows each wave to be independently verified.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Register all new config keys in `config-defaults.ts` with dot-notation namespacing:
  - `system.maxUploadBytes` — default `52428800` (50 MB), type `number`
  - `system.maxConcurrentExecutions` — default `3`, type `number`
  - `git.timeoutSec` — default `30`, type `number`
  - `git.branchTemplate` — default `vk/{taskIdShort}-`, type `string`
  - `search.resultLimit` — default `20`, type `number`
  - `search.allModeCap` — default `5`, type `number`
  - `search.debounceMs` — default `250`, type `number`
  - `search.snippetLength` — default `80`, type `number`

- **D-02:** Each consumer calls `getConfigValue<T>(key, default)` directly — no caching or React hook wrapper at this phase. Phase 14 addresses realtime/cache concerns.

- **D-03:** Server-side consumers (`asset-actions.ts`, `search-actions.ts`, `process-manager.ts`, `execute.ts`) call `getConfigValue` directly. Client-side consumers (`search-dialog.tsx`, `task-detail-panel.tsx`) load values via a server action or initial page props.

- **D-04:** `process-manager.ts` changes `MAX_CONCURRENT` from a constant to an async `getMaxConcurrent()` function that reads from config. The `canStartExecution()` function becomes async.

- **D-05:** Template string supports two interpolation variables: `{taskId}` (full cuid) and `{taskIdShort}` (first 4 chars of cuid). Default template `vk/{taskIdShort}-` preserves current behavior exactly.

- **D-06:** Template interpolation is a simple string replace in a new `interpolateBranchTemplate(template, taskId)` utility — no regex or complex parsing.

- **D-07:** Group parameters into collapsible sections within `system-config.tsx`, ordered by domain:
  1. **Git Path Mapping Rules** (existing Phase 12 table — stays as-is)
  2. **System** — Upload size limit, max concurrent executions
  3. **Git** — Timeout, branch naming template
  4. **Search** — Result limit, All-mode cap, debounce delay, snippet length

- **D-08:** Each section has a heading, brief description, and a set of labeled input controls. Sections are always visible (no accordion/collapse), matching the existing settings page pattern.

- **D-09:** Numeric parameters use `<Input type="number">` with `min`/`max` attributes. Branch template uses a text `<Input>` with a hint showing available variables.

- **D-10:** Each parameter shows: label, current value input, unit/hint text (e.g., "MB", "ms", "characters"), and a save button per-section (not per-field).

- **D-11:** Save button per section — user changes one or more values within a section, clicks "Save" to persist all section values at once.

- **D-12:** Numeric validation ranges (enforced both client-side and in `setConfigValue`):
  - `system.maxUploadBytes`: 1 MB – 500 MB (stored in bytes, UI shows MB)
  - `system.maxConcurrentExecutions`: 1 – 10
  - `git.timeoutSec`: 5 – 300 seconds
  - `search.resultLimit`: 5 – 100
  - `search.allModeCap`: 1 – 20
  - `search.debounceMs`: 50 – 1000 ms
  - `search.snippetLength`: 20 – 500 characters

- **D-13:** Branch template validation: must contain either `{taskId}` or `{taskIdShort}` — otherwise the branch name won't be unique.

### Claude's Discretion

- Exact section heading/description text (uses i18n `t()` calls)
- Whether to show a "Reset to default" button per parameter or per section
- Upload size input unit display (MB slider vs. plain number input showing MB)
- Visual spacing and layout within sections

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope (auto mode).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYS-01 | User can configure maximum upload file size (currently hardcoded 50 MB) | `asset-actions.ts` line 54 holds `MAX_UPLOAD_BYTES`; replace with `await getConfigValue("system.maxUploadBytes", 52428800)` inside `uploadAsset()`. UI shows MB, stores bytes. |
| SYS-02 | User can configure maximum concurrent execution count (currently hardcoded 3) | `process-manager.ts` line 3 holds `MAX_CONCURRENT = 3`; `canStartExecution()` becomes `async canStartExecution()` reading from config. All call sites traced to `agent-actions.ts`. |
| GIT-03 | User can configure task branch naming template (currently hardcoded `vk/${taskId}-`) | `task-detail-panel.tsx` line 198 hardcodes template; needs new `getBranchTemplate()` server action + `interpolateBranchTemplate()` utility; loaded in client component via `useEffect`. |
| GIT-04 | User can configure Git operation timeout (clone/status/other) | `execute.ts` line 19 defaults `timeoutSec = 0`; caller in `agent-actions.ts` must read `git.timeoutSec` config and pass it to `execute(ctx)`. |
| SRCH-05 | User can configure search parameters (result count, All-mode cap, debounce delay, snippet length) | Four hardcoded values in `search-actions.ts` (lines 35, 44, 76) and `search-dialog.tsx` (line 91); server actions read from config; client component loads debounce value on mount. |
</phase_requirements>

---

## Standard Stack

### Core (all already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@prisma/client` | existing | SystemConfig CRUD | Phase 11 infrastructure, already in use |
| Next.js Server Actions | existing | `getConfigValue` / `setConfigValue` | Phase 11 pattern, verified working |
| React `useState` / `useEffect` | existing | Client-side config load on mount | Established pattern in `system-config.tsx` |
| shadcn/ui `Input`, `Button` | existing | Form controls | Used throughout settings UI |
| `useI18n()` | existing | Translation keys | All settings text goes through i18n |

### No new packages required

The entire phase uses existing infrastructure. Step 2.6 (environment audit) is not applicable — this is a code-wiring phase with no external tool dependencies.

---

## Architecture Patterns

### Pattern 1: Server-Side Consumer Wiring

Applies to: `asset-actions.ts`, `search-actions.ts`, `execute.ts` call site.

**What:** Replace module-level constant with `await getConfigValue(key, hardcodedDefault)` at the point of use inside the async function.

**Example — `asset-actions.ts`:**
```typescript
// BEFORE (line 54)
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function uploadAsset(formData: FormData) {
  // ...
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("File too large (max 50 MB)");
```

```typescript
// AFTER — no module-level constant
import { getConfigValue } from "@/actions/config-actions";

export async function uploadAsset(formData: FormData) {
  const maxBytes = await getConfigValue<number>("system.maxUploadBytes", 52428800);
  if (file.size > maxBytes) throw new Error(`File too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`);
```

### Pattern 2: Async Function Promotion (process-manager.ts)

**What:** `canStartExecution()` is currently sync; it must become async to call `getConfigValue`.

**Current call chain:**
- `canStartExecution()` is called in `agent-actions.ts` → `startTaskExecution()`

**Migration:**
```typescript
// BEFORE
export function canStartExecution(): boolean {
  return runningProcesses.size < MAX_CONCURRENT;
}

// AFTER
export async function canStartExecution(): Promise<boolean> {
  const max = await getConfigValue<number>("system.maxConcurrentExecutions", 3);
  return runningProcesses.size < max;
}
```

The call site in `agent-actions.ts` already uses `await` for other operations, so `await canStartExecution()` is a compatible change.

**Important:** `process-manager.ts` is a non-Next.js server module (no `"use server"` directive). It can import `getConfigValue` only if `config-actions.ts` can be cleanly imported in that context. Since `config-actions.ts` uses `"use server"` and imports `db` and `CONFIG_DEFAULTS`, test this import boundary. If it causes issues, extract a thin `readConfigValue(key, default)` function from `config-actions.ts` into a pure lib file (like `src/lib/config-reader.ts`) that `process-manager.ts` can safely import. Confidence: MEDIUM — verify at implementation time.

### Pattern 3: Branch Template Utility

New file: `src/lib/branch-template.ts` (pure utility, no Next.js imports — safe for all contexts).

```typescript
// Source: CONTEXT.md D-05, D-06
export function interpolateBranchTemplate(template: string, taskId: string): string {
  return template
    .replace("{taskId}", taskId)
    .replace("{taskIdShort}", taskId.slice(0, 4));
}

export function validateBranchTemplate(template: string): boolean {
  return template.includes("{taskId}") || template.includes("{taskIdShort}");
}
```

### Pattern 4: Client Component Config Load

Applies to: `task-detail-panel.tsx` (branch template), `search-dialog.tsx` (debounce ms).

These are client components that need server-config values. The established pattern from `system-config.tsx`:

```typescript
// In system-config.tsx (line 42-44) — the established pattern
useEffect(() => {
  getConfigValue<GitPathRule[]>("git.pathMappingRules", []).then(setRules);
}, []);
```

**For `task-detail-panel.tsx`:**
```typescript
// Add state + useEffect to load branch template
const [branchTemplate, setBranchTemplate] = useState("vk/{taskIdShort}-");

useEffect(() => {
  getConfigValue<string>("git.branchTemplate", "vk/{taskIdShort}-")
    .then(setBranchTemplate);
}, []);

// In render:
branch={interpolateBranchTemplate(branchTemplate, task.id)}
```

**For `search-dialog.tsx`:**
```typescript
// Add state for debounce delay, initialized to default
const [debounceMs, setDebounceMs] = useState(250);

useEffect(() => {
  getConfigValue<number>("search.debounceMs", 250).then(setDebounceMs);
}, []);

// In debounced search useEffect:
timerRef.current = setTimeout(async () => { ... }, debounceMs);
```

Note: The debounce `useEffect` depends on `debounceMs` — add it to the dependency array.

### Pattern 5: Settings UI Section (new sections in system-config.tsx)

The established pattern from `general-config.tsx` — each section is a `<div className="mt-8">` with heading + description + controls:

```typescript
{/* System Parameters section */}
<div className="mt-8">
  <h3 className="text-lg font-semibold">{t("settings.config.system.title")}</h3>
  <p className="mt-0.5 text-sm text-muted-foreground">
    {t("settings.config.system.desc")}
  </p>
  <div className="mt-4 space-y-4">
    {/* Upload size */}
    <div className="flex items-center gap-4">
      <div className="flex-1">
        <label className="text-sm font-medium">{t("settings.config.system.maxUpload")}</label>
        <p className="text-xs text-muted-foreground">{t("settings.config.system.maxUploadHint")}</p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          max={500}
          value={systemForm.maxUploadMb}
          onChange={(e) => setSystemForm((f) => ({ ...f, maxUploadMb: Number(e.target.value) }))}
          className="w-24 text-right"
        />
        <span className="text-sm text-muted-foreground">MB</span>
      </div>
    </div>
    {/* ... more fields ... */}
    <Button size="sm" onClick={handleSaveSystem}>{t("common.save")}</Button>
  </div>
</div>
```

### Recommended Project Structure (additions only)

```
src/
├── lib/
│   └── branch-template.ts       # NEW: interpolateBranchTemplate utility
├── actions/
│   └── config-actions.ts        # MODIFY: no changes to exports, import may be added
├── lib/
│   └── config-defaults.ts       # MODIFY: add 8 new entries
├── lib/adapters/
│   └── process-manager.ts       # MODIFY: canStartExecution() becomes async
├── actions/
│   ├── asset-actions.ts         # MODIFY: replace MAX_UPLOAD_BYTES
│   └── search-actions.ts        # MODIFY: replace 4 hardcoded values
├── components/
│   ├── task/
│   │   └── task-detail-panel.tsx # MODIFY: load branch template from config
│   ├── layout/
│   │   └── search-dialog.tsx     # MODIFY: load debounce from config
│   └── settings/
│       └── system-config.tsx     # MODIFY: add System, Git params, Search sections
└── lib/
    └── i18n.tsx                  # MODIFY: add ~20 translation keys
```

### Anti-Patterns to Avoid

- **Module-level `await`:** Do NOT call `await getConfigValue(...)` at module initialization time. Always call inside the async function body to avoid Node.js module loading issues.
- **Hardcoded error messages after wiring:** When replacing `MAX_UPLOAD_BYTES`, update the error message to use the dynamic value (not "max 50 MB" forever).
- **Missing dependency array entries:** When `debounceMs` is loaded from config and used in a `useEffect`, it must be in the dependency array — otherwise stale closure captures the initial `250` value.
- **Sync `canStartExecution()` callers:** After promoting to async, any caller that doesn't `await` will silently get a Promise (truthy), bypassing the concurrency check.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config persistence | Custom DB table | `setConfigValue` from Phase 11 | Already implemented, tested, upserts correctly |
| Config reads | Re-query DB each time with raw SQL | `getConfigValue<T>` | Type-safe, handles JSON parse errors, returns default |
| Batch config reads | Sequential `getConfigValue` calls | `getConfigValues(keys)` | Single DB query for multiple keys |
| Template interpolation | Regex-based parsing | Simple `string.replace()` per D-06 | Only two variables; complexity is unwarranted |
| Form state management | Form library (react-hook-form, etc.) | Local `useState` per section | Established pattern in `system-config.tsx`; no validation library needed |

---

## Common Pitfalls

### Pitfall 1: `process-manager.ts` Import Boundary

**What goes wrong:** `process-manager.ts` is a plain Node.js module without `"use server"`. Importing `config-actions.ts` (which has `"use server"` and transitively imports `next/cache` internals) may fail or cause unexpected behavior in certain execution contexts.

**Why it happens:** Next.js "use server" modules sometimes have side effects or runtime expectations that don't work when imported from non-Next.js server modules.

**How to avoid:** Import only the raw db query logic. If import fails, create `src/lib/config-reader.ts` that re-exports a bare `readConfigValue<T>()` that does the Prisma query directly — no `"use server"`, no `next/cache`. This file already follows the same pattern as `fts.ts` and `file-utils.ts` which must be "Next.js-free."

**Warning signs:** TypeScript errors about "use server" boundary violations, or runtime errors about `revalidatePath` being called outside a request context.

### Pitfall 2: `canStartExecution()` Async Migration — Silent Callers

**What goes wrong:** After making `canStartExecution()` async, a caller that doesn't `await` it receives `Promise<boolean>`. Since a Promise is truthy, `if (canStartExecution())` will always pass — removing the concurrency guard entirely.

**Why it happens:** TypeScript will flag this if the caller is typed, but if there's any `// @ts-ignore` or dynamic invocation, it silently breaks.

**How to avoid:** Search ALL call sites of `canStartExecution` before changing the signature. Confirmed single caller: `agent-actions.ts` → `startTaskExecution()`. Update that call to `await canStartExecution()`.

### Pitfall 3: Upload Size Error Message Stale After Wiring

**What goes wrong:** Current error is `"File too large (max 50 MB)"`. After replacing `MAX_UPLOAD_BYTES` with a configurable value, user sets 100 MB limit but error still says "max 50 MB".

**How to avoid:** Build the error message dynamically from the fetched value: `` `File too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` ``

### Pitfall 4: Debounce useEffect Stale Closure

**What goes wrong:** `search-dialog.tsx` loads `debounceMs` from config on mount. The debounced search `useEffect` captures the initial value `250` in its closure. Config loads 500 ms, but search still debounces at 250 ms.

**How to avoid:** Add `debounceMs` to the dependency array of the search `useEffect`. This causes it to re-run when the config loads, correctly using the new value.

### Pitfall 5: Upload Size Unit Mismatch

**What goes wrong:** Config stores bytes (`system.maxUploadBytes = 52428800`) but the settings UI input works in MB. If the form initializes from the raw byte value, the user sees "52428800" instead of "50".

**How to avoid:** Convert on load: `maxUploadMb = Math.round(storedBytes / 1024 / 1024)`. Convert on save: `storedBytes = inputMb * 1024 * 1024`. Apply validation in MB (1–500) before converting to bytes for storage.

### Pitfall 6: Branch Template Validation Timing

**What goes wrong:** User clears the template field and saves — an empty string passes neither `{taskId}` nor `{taskIdShort}` check, but the UI save handler might not validate before calling `setConfigValue`.

**How to avoid:** In the Git params section save handler, call `validateBranchTemplate(template)` before saving. Show an inline error message if invalid. Do NOT save to DB until validation passes.

---

## Code Examples

### CONFIG_DEFAULTS additions (verified pattern from Phase 11)

```typescript
// src/lib/config-defaults.ts — add to CONFIG_DEFAULTS record
"system.maxUploadBytes": {
  defaultValue: 52428800,
  type: "number",
  label: "Max Upload Size (bytes)",
},
"system.maxConcurrentExecutions": {
  defaultValue: 3,
  type: "number",
  label: "Max Concurrent Executions",
},
"git.timeoutSec": {
  defaultValue: 30,
  type: "number",
  label: "Git Operation Timeout (seconds)",
},
"git.branchTemplate": {
  defaultValue: "vk/{taskIdShort}-",
  type: "string",
  label: "Branch Naming Template",
},
"search.resultLimit": {
  defaultValue: 20,
  type: "number",
  label: "Search Result Limit",
},
"search.allModeCap": {
  defaultValue: 5,
  type: "number",
  label: "All-Mode Per-Type Cap",
},
"search.debounceMs": {
  defaultValue: 250,
  type: "number",
  label: "Search Debounce (ms)",
},
"search.snippetLength": {
  defaultValue: 80,
  type: "number",
  label: "Snippet Length (characters)",
},
```

### search-actions.ts wiring (4 hardcoded values)

```typescript
// BEFORE (lines 35, 44, 76, and allModeCap):
snippet: row.content ? row.content.slice(0, 80) : undefined,
const CAP = 5;
take: 20,

// AFTER — read all at once with getConfigValues
export async function globalSearch(query: string, category: SearchCategory = "task"): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const q = query.trim();

  const cfg = await getConfigValues([
    "search.resultLimit",
    "search.allModeCap",
    "search.snippetLength",
  ]);
  const resultLimit = (cfg["search.resultLimit"] as number) ?? 20;
  const allModeCap = (cfg["search.allModeCap"] as number) ?? 5;
  const snippetLength = (cfg["search.snippetLength"] as number) ?? 80;

  if (category === "all") {
    // Use allModeCap instead of hardcoded CAP = 5
    const collect = (res: PromiseSettledResult<SearchResult[]>) =>
      res.status === "fulfilled" ? res.value.slice(0, allModeCap) : [];
    // ...
  }
  // use resultLimit in take:, snippetLength in .slice(0, snippetLength)
}
```

### execute.ts timeout wiring

```typescript
// The caller (agent-actions.ts) must fetch timeout and pass it to execute()
// execute.ts itself accepts timeoutSec as a parameter already (line 19)
// So the change is in the caller:

// In agent-actions.ts or wherever execute() is called:
const timeoutSec = await getConfigValue<number>("git.timeoutSec", 30);
const result = await execute({ ...ctx, timeoutSec });
```

---

## Hardcoded Values Inventory (complete)

| File | Line | Current Value | Config Key | Notes |
|------|------|---------------|-----------|-------|
| `src/actions/asset-actions.ts` | 54 | `50 * 1024 * 1024` | `system.maxUploadBytes` | Move inside `uploadAsset()` |
| `src/lib/adapters/process-manager.ts` | 3 | `MAX_CONCURRENT = 3` | `system.maxConcurrentExecutions` | `canStartExecution()` → async |
| `src/lib/adapters/claude-local/execute.ts` | 19 | `timeoutSec = 0` | `git.timeoutSec` | Default 0 means no timeout; new default 30 |
| `src/components/task/task-detail-panel.tsx` | 198 | `` `vk/${task.id.slice(0, 4)}-` `` | `git.branchTemplate` | Client component; load via `useEffect` |
| `src/components/layout/search-dialog.tsx` | 91 | `250` | `search.debounceMs` | Client component; load via `useEffect` |
| `src/actions/search-actions.ts` | 35 | `.slice(0, 80)` | `search.snippetLength` | Server action; direct `getConfigValue` |
| `src/actions/search-actions.ts` | 44 | `CAP = 5` | `search.allModeCap` | Server action; direct `getConfigValue` |
| `src/actions/search-actions.ts` | 76 | `take: 20` | `search.resultLimit` | Server action; direct `getConfigValue` |

Note on `execute.ts` line 19: `timeoutSec = 0` is a destructuring default in the `ExecutionContext` destructure, not a module-level constant. The config read must happen in the caller that constructs the `ExecutionContext` and passes `timeoutSec`. The execute.ts file itself stays unchanged — only the caller needs updating.

---

## i18n Keys Required

Add to both `zh` and `en` translation objects in `src/lib/i18n.tsx`:

**System section (~6 keys):**
- `settings.config.system.title`
- `settings.config.system.desc`
- `settings.config.system.maxUpload`
- `settings.config.system.maxUploadHint`
- `settings.config.system.maxConcurrent`
- `settings.config.system.maxConcurrentHint`

**Git params section (~6 keys):**
- `settings.config.gitParams.title`
- `settings.config.gitParams.desc`
- `settings.config.gitParams.timeout`
- `settings.config.gitParams.timeoutHint`
- `settings.config.gitParams.branchTemplate`
- `settings.config.gitParams.branchTemplateHint`

**Search section (~10 keys):**
- `settings.config.search.title`
- `settings.config.search.desc`
- `settings.config.search.resultLimit`
- `settings.config.search.resultLimitHint`
- `settings.config.search.allModeCap`
- `settings.config.search.allModeCapHint`
- `settings.config.search.debounceMs`
- `settings.config.search.debounceMsHint`
- `settings.config.search.snippetLength`
- `settings.config.search.snippetLengthHint`

**Validation messages (~2 keys):**
- `settings.config.gitParams.branchTemplateInvalid`
- `settings.config.system.saveSuccess` (toast or inline)

Total: ~24 keys × 2 locales = ~48 new translation entries.

---

## Validation Architecture

Nyquist validation is enabled (no `workflow.nyquist_validation: false` in config.json).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (vitest) |
| Config file | `vitest.config.ts` |
| Quick run command | `pnpm test:run -- tests/unit/` |
| Full suite command | `pnpm test:run` |
| E2E command | `pnpm playwright test tests/e2e/settings.spec.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYS-01 | `uploadAsset` rejects file over configured limit | unit | `pnpm test:run -- tests/unit/actions/asset-actions.test.ts` | ✅ (extend) |
| SYS-01 | `uploadAsset` accepts file within configured limit | unit | same | ✅ (extend) |
| SYS-02 | `canStartExecution()` returns false when running >= configured max | unit | `pnpm test:run -- tests/unit/lib/process-manager.test.ts` | ❌ Wave 0 |
| GIT-03 | `interpolateBranchTemplate` produces correct branch name for both vars | unit | `pnpm test:run -- tests/unit/lib/branch-template.test.ts` | ❌ Wave 0 |
| GIT-04 | `execute()` caller passes configured timeout to execution context | unit | `pnpm test:run -- tests/unit/actions/config-actions.test.ts` | ✅ (extend) |
| SRCH-05 | `globalSearch` uses configured resultLimit in query | unit | `pnpm test:run -- tests/unit/actions/search-actions.test.ts` | ✅ (extend) |
| SRCH-05 | `globalSearch` uses configured allModeCap in "all" mode | unit | same | ✅ (extend) |
| SRCH-05 | `globalSearch` uses configured snippetLength in note results | unit | same | ✅ (extend) |
| SRCH-05 | Settings UI: search section visible with correct fields | e2e | `pnpm playwright test tests/e2e/settings.spec.ts` | ✅ (extend) |
| SYS-01/SYS-02 | Settings UI: system section visible with correct fields | e2e | same | ✅ (extend) |
| GIT-03/GIT-04 | Settings UI: git params section visible with correct fields | e2e | same | ✅ (extend) |

### Sampling Rate

- **Per task commit:** `pnpm test:run -- tests/unit/`
- **Per wave merge:** `pnpm test:run` (all unit tests)
- **Phase gate:** Full unit + E2E suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/unit/lib/process-manager.test.ts` — covers SYS-02 (`canStartExecution` async with mock config)
- [ ] `tests/unit/lib/branch-template.test.ts` — covers GIT-03 (`interpolateBranchTemplate` pure function, `validateBranchTemplate`)

*(All other coverage uses existing test files with additional test cases)*

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — this is a pure code-wiring phase using existing project stack).

---

## Runtime State Inventory

Step 2.5: NOT APPLICABLE (this is not a rename/refactor/migration phase — no existing runtime state needs changing).

---

## Open Questions

1. **`process-manager.ts` import boundary**
   - What we know: `config-actions.ts` uses `"use server"` and `process-manager.ts` does not. Phase 11 decision notes say `file-utils.ts` and `fts.ts` must be "Next.js-free."
   - What's unclear: Whether importing `config-actions.ts` from `process-manager.ts` will cause a Next.js boundary violation at runtime.
   - Recommendation: At implementation start, test the import. If it fails, extract a thin `src/lib/config-reader.ts` with a bare Prisma-based `readConfigValue<T>()` — no "use server", no next/cache. This is a 5-minute fallback and should be planned for.

2. **`execute.ts` caller location**
   - What we know: `execute.ts` accepts `timeoutSec` as part of `ExecutionContext`; currently defaults to `0` (no timeout). The default `0` means infinite timeout — new default `30` is a behavior change for all existing executions.
   - What's unclear: Whether there's exactly one caller or multiple callers of `execute()` in the codebase.
   - Recommendation: Grep for all `execute(` call sites before planning the wiring task. Confirm the single caller is `agent-actions.ts` (or wherever `startTaskExecution` launches the process).

---

## Project Constraints (from CLAUDE.md)

- **Next.js variant warning:** `AGENTS.md` explicitly warns: "This is NOT the Next.js you know — APIs, conventions, and file structure may all differ from training data. Read relevant guide in `node_modules/next/dist/docs/` before writing any code." However, Phase 13 makes no architectural Next.js changes — it wires existing patterns already established in Phase 11/12. No new Next.js API surface is introduced.
- **Immutability:** All state updates must use spread/immutable patterns (`setForm(f => ({ ...f, field: value }))`). Existing `system-config.tsx` already follows this correctly.
- **File size:** `i18n.tsx` is approaching 800 lines (STATE.md notes this). Adding ~48 translation entries will push it slightly over. Per `REQUIREMENTS.md` Out of Scope: "i18n.tsx 拆分 — 虽然接近 800 行但可以后续做，不影响配置化." Add the keys anyway; do not split the file.
- **No console.log:** TypeScript hooks warn on `console.log` in production code. All error logging must use appropriate patterns.
- **Error handling:** All async config reads must be wrapped or rely on `getConfigValue`'s built-in try/catch which returns the default on failure — this satisfies the "never silently swallow" requirement since callers get the safe default.
- **No hardcoded secrets:** Not applicable to this phase.

---

## Sources

### Primary (HIGH confidence)

- Direct source inspection of `src/actions/config-actions.ts` — `getConfigValue`, `setConfigValue`, `getConfigValues` signatures and behavior
- Direct source inspection of `src/lib/config-defaults.ts` — `ConfigEntry` interface and registry structure
- Direct source inspection of `src/components/settings/system-config.tsx` — full established UI pattern for settings sections
- Direct source inspection of all 8 hardcoded value sites listed in CONTEXT.md canonical refs
- Direct source inspection of `tests/unit/actions/config-actions.test.ts` — test patterns to follow
- `13-CONTEXT.md` — locked decisions D-01 through D-13

### Secondary (MEDIUM confidence)

- `vitest.config.ts` — confirmed test runner, environment, include patterns
- `tests/e2e/settings.spec.ts` — existing E2E test structure to extend

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project, no new dependencies
- Architecture patterns: HIGH — verified from existing source code (Phase 11/12 established the patterns)
- Consumer wiring: HIGH — exact file/line locations confirmed from source inspection
- Process-manager import boundary: MEDIUM — potential issue flagged, fallback documented
- Pitfalls: HIGH — derived from actual code analysis, not guesswork

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable infrastructure, 30-day window)
