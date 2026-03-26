# Phase 2: CLI Adapter Verification - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning
**Mode:** auto (all gray areas auto-resolved with recommended defaults)

<domain>
## Phase Boundary

Add a live connection test button to the AI Tools settings panel. Each registered adapter gets a "Test Connection" button that calls `testEnvironment()`, displays per-check pass/fail results with actionable messages, shows CLI version when available, and debounces concurrent test attempts. The test is user-initiated only (never on page mount).

</domain>

<decisions>
## Implementation Decisions

### Test Results Display
- **D-01:** Show test results as a status card with a check list below the test button. Each check renders as a row with a pass/fail icon (checkmark or X) and the message string from `TestCheck`. Consistent with existing Card pattern in AIToolsConfig.
- **D-02:** When no test has been run yet, show nothing (no placeholder card). Results appear only after the user clicks Test Connection.

### Test Button Placement
- **D-03:** Each registered adapter (from `listAdapters()`) gets its own section/card within the AI Tools panel. Each section shows the adapter name, a Test Connection button, and test results below.
- **D-04:** The existing agent config editor (default agent selection, append prompt) remains as-is. The test connection UI is a separate section, visually distinct — test connection is about verifying CLI availability, not configuring agent behavior.

### Version Display
- **D-05:** Add a version check to the test flow — run `claude --version` (or equivalent) and include the version string in the test results. Display version in the adapter section header or as an additional check row when available.
- **D-06:** Version display is best-effort. If version extraction fails, show "Version: unknown" — do not block the test.

### Loading/Progress UX
- **D-07:** While testing, the Test Connection button shows a spinner icon and "Testing..." text. The button is disabled during the test to prevent concurrent attempts (satisfies CLIV-04 debounce requirement).
- **D-08:** No progress bar needed — the test runs as a single async operation with a loading state. The 45s timeout in the hello probe is handled server-side.

### Claude's Discretion
- Exact card layout and spacing — follow existing AIToolsConfig visual patterns
- i18n translation keys for test connection labels — follow existing naming convention
- Whether to use a server action or API route for triggering testEnvironment() — Claude can decide the best approach given the 45s timeout constraint
- Icon choices for pass/fail indicators — any clear, accessible iconography

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Adapter System
- `src/lib/adapters/types.ts` — `TestResult`, `TestCheck`, `AdapterModule` interfaces defining the test API
- `src/lib/adapters/registry.ts` — `listAdapters()` and `getAdapter()` for discovering registered adapters
- `src/lib/adapters/claude-local/test.ts` — Existing `testEnvironment()` implementation with 3 checks (command resolution, API key, hello probe)
- `src/lib/adapters/process-utils.ts` — `ensureCommandResolvable()`, `runChildProcess()` used by test

### Settings Page
- `src/app/settings/page.tsx` — Settings page with section routing (general/ai-tools/prompts)
- `src/components/settings/ai-tools-config.tsx` — Existing AI Tools panel (agent config, NOT test connection)
- `src/components/settings/settings-nav.tsx` — Navigation component

### i18n
- `src/lib/i18n.tsx` — Translation system, `useI18n()` hook — all new strings must use `t()`

### Prior Phase Context
- `.planning/phases/01-theme-general-settings/01-CONTEXT.md` — Phase 1 decisions (nav structure, theme/i18n patterns)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TestResult` / `TestCheck` types: Already defined in `src/lib/adapters/types.ts` — the backend API is ready
- `testEnvironment(cwd)`: Fully implemented for claude-local — returns checks with name/passed/message
- `Card`, `CardContent`, `Button` components: Used extensively in AIToolsConfig — reuse for test results
- `useI18n()` hook: Must be used for all new user-facing strings
- `Loader2` icon from `lucide-react`: Standard spinner for loading states in this codebase

### Established Patterns
- Client components call server actions directly for data operations
- `useTransition` + `router.refresh()` for server revalidation after mutations
- `useState` for local UI state (loading, results)
- No form library — controlled components with explicit state

### Integration Points
- `settings/page.tsx`: The `activeSection === "ai-tools"` branch renders AIToolsConfig — test connection UI either extends this component or adds a sibling section
- `registry.ts`: `listAdapters()` provides the list of adapters to show test buttons for
- Server action or API route needed: `testEnvironment()` runs server-side (spawns child process) — needs a server-side entry point callable from the client
- `i18n.tsx`: New translation keys needed for test connection labels (settings.aiTools.testConnection, etc.)

</code_context>

<specifics>
## Specific Ideas

- The "检测到最近使用" (recently detected) banner currently hardcoded in AIToolsConfig is a static mockup — Phase 2 replaces this concept with actual live connection testing
- Per STATE.md decision: CLI test must be user-initiated only — never triggered on page mount due to 45s blocking timeout

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (auto mode).

</deferred>

---

*Phase: 02-cli-adapter-verification*
*Context gathered: 2026-03-26*
