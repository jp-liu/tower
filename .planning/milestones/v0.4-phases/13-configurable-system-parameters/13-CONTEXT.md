# Phase 13: Configurable System Parameters - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Mode:** auto (all gray areas auto-resolved with recommended defaults)

<domain>
## Phase Boundary

Wire hardcoded system values (upload limit, concurrent executions, Git timeout, branch template, search parameters) to SystemConfig. Each consumer reads from the database via `getConfigValue`, and the settings page provides UI controls for each parameter. No new data model — reuses Phase 11's key-value infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Config Key Registry
- **D-01:** Register all new config keys in `config-defaults.ts` with dot-notation namespacing:
  - `system.maxUploadBytes` — default `52428800` (50 MB), type `number`
  - `system.maxConcurrentExecutions` — default `3`, type `number`
  - `git.timeoutSec` — default `30`, type `number`
  - `git.branchTemplate` — default `vk/{taskIdShort}-`, type `string`
  - `search.resultLimit` — default `20`, type `number`
  - `search.allModeCap` — default `5`, type `number`
  - `search.debounceMs` — default `250`, type `number`
  - `search.snippetLength` — default `80`, type `number`

### Config Wiring Pattern
- **D-02:** Each consumer site calls `getConfigValue<T>(key, default)` directly — no caching or React hook wrapper at this phase. Phase 14 addresses realtime/cache concerns.
- **D-03:** Server-side consumers (asset-actions.ts, search-actions.ts, process-manager.ts, execute.ts) call `getConfigValue` directly. Client-side consumers (search-dialog.tsx, task-detail-panel.tsx) load values via a server action or initial page props.
- **D-04:** `process-manager.ts` changes `MAX_CONCURRENT` from a constant to an async `getMaxConcurrent()` function that reads from config. The `canStartProcess()` function becomes async.

### Branch Template
- **D-05:** Template string supports two interpolation variables: `{taskId}` (full cuid) and `{taskIdShort}` (first 4 chars of cuid). Default template `vk/{taskIdShort}-` preserves current behavior exactly.
- **D-06:** Template interpolation is a simple string replace in a new `interpolateBranchTemplate(template, taskId)` utility — no regex or complex parsing.

### Settings UI Organization
- **D-07:** Group parameters into collapsible sections within `system-config.tsx`, ordered by domain:
  1. **Git Path Mapping Rules** (existing Phase 12 table — stays as-is)
  2. **System** — Upload size limit, max concurrent executions
  3. **Git** — Timeout, branch naming template
  4. **Search** — Result limit, All-mode cap, debounce delay, snippet length
- **D-08:** Each section has a heading, brief description, and a set of labeled input controls. Sections are always visible (no accordion/collapse), matching the existing settings page pattern (General, AI Tools, etc. are all visible).

### Input Controls
- **D-09:** Numeric parameters use `<Input type="number">` with `min`/`max` attributes. Branch template uses a text `<Input>` with a hint showing available variables.
- **D-10:** Each parameter shows: label, current value input, unit/hint text (e.g., "MB", "ms", "characters"), and a save button per-section (not per-field).
- **D-11:** Save button per section — user changes one or more values within a section, clicks "Save" to persist all section values at once. Avoids excessive DB writes on every keystroke.

### Validation Rules
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
- Exact section heading/description text (uses i18n t() calls)
- Whether to show a "Reset to default" button per parameter or per section
- Upload size input unit display (MB slider vs. plain number input showing MB)
- Visual spacing and layout within sections

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Hardcoded Values to Replace
- `src/actions/asset-actions.ts` §54 — `MAX_UPLOAD_BYTES = 50 * 1024 * 1024` (upload size limit)
- `src/lib/adapters/process-manager.ts` §3 — `MAX_CONCURRENT = 3` (concurrent execution cap)
- `src/lib/adapters/claude-local/execute.ts` §19 — `timeoutSec = 0` (default Git timeout)
- `src/components/task/task-detail-panel.tsx` §198 — `` `vk/${task.id.slice(0, 4)}-` `` (branch template)
- `src/components/layout/search-dialog.tsx` §91 — `250` (debounce ms)
- `src/actions/search-actions.ts` §35 — `.slice(0, 80)` (snippet length)
- `src/actions/search-actions.ts` §76 — `take: 20` (search result limit)
- `src/actions/search-actions.ts` §44 — `CAP = 5` (All-mode per-type cap)

### Config Infrastructure (Phase 11)
- `src/actions/config-actions.ts` — getConfigValue/setConfigValue/getConfigValues server actions
- `src/lib/config-defaults.ts` — CONFIG_DEFAULTS registry (add 8 new entries)
- `prisma/schema.prisma` — SystemConfig model (no schema changes needed)

### Settings UI (Phase 12)
- `src/components/settings/system-config.tsx` — Current component (Git rules table only — add new sections below)

### i18n
- `src/lib/i18n.tsx` — Add translation keys under `settings.config.system.*`, `settings.config.gitParams.*`, `settings.config.search.*`

### Requirements
- `.planning/REQUIREMENTS.md` — SYS-01, SYS-02, GIT-03, GIT-04, SRCH-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `config-actions.ts` (getConfigValue/setConfigValue/getConfigValues): Ready to use for all 8 new parameters
- `config-defaults.ts` (CONFIG_DEFAULTS): Add entries for each new parameter
- `system-config.tsx`: Extend with new sections below the Git rules table
- `Input` component (`@/components/ui/input`): Already used for inline editing in Git rules
- `Button` component: Save/cancel pattern established in Phase 12
- `useI18n()` hook: Translation support ready

### Established Patterns
- Settings section layout: heading + description + controls (see `general-config.tsx`, `system-config.tsx`)
- Form state: Local `useState` per section (no form library)
- Config read: `useEffect` + `getConfigValue` on mount (see system-config.tsx line 42-44)
- Config write: `await setConfigValue(key, value)` + local state update
- Immutable state updates: `setRules(updated)` pattern from Phase 12

### Integration Points
- `src/lib/config-defaults.ts`: Add 8 new config entries
- `src/components/settings/system-config.tsx`: Add System, Git params, Search sections
- `src/actions/asset-actions.ts`: Replace `MAX_UPLOAD_BYTES` constant with `getConfigValue` call
- `src/lib/adapters/process-manager.ts`: Replace `MAX_CONCURRENT` with async config read
- `src/lib/adapters/claude-local/execute.ts`: Read timeout from config
- `src/components/task/task-detail-panel.tsx`: Read branch template from config (needs server action for client component)
- `src/components/layout/search-dialog.tsx`: Read debounce from config (client component — load on mount)
- `src/actions/search-actions.ts`: Read resultLimit, allModeCap, snippetLength from config
- `src/lib/i18n.tsx`: Add ~20 translation keys

</code_context>

<specifics>
## Specific Ideas

- Upload size control: UI displays and accepts values in MB (e.g., "50 MB"), but stores in bytes for direct comparison with `file.size`
- Branch template hint text should show example: `vk/{taskIdShort}-` produces `vk/abc1-` for task `abc1def2...`
- Search parameters section should note that debounce affects typing responsiveness and snippet length affects result preview density

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (auto mode).

</deferred>

---

*Phase: 13-configurable-system-parameters*
*Context gathered: 2026-03-30*
