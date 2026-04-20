# Phase 12: Git Path Mapping Rules - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Mode:** auto (all gray areas auto-resolved with recommended defaults)

<domain>
## Phase Boundary

Users can manage Git path mapping rules from the settings page (add/edit/delete), and those rules auto-apply when a Git URL is entered during project creation. Replaces the hardcoded mapping logic in `src/lib/git-url.ts`.

</domain>

<decisions>
## Implementation Decisions

### Rule Data Model
- **D-01:** Store rules as a JSON array in SystemConfig with key `git.pathMappingRules`. No new Prisma model — reuses Phase 11's key-value infrastructure.
- **D-02:** Each rule is an object: `{ id: string, host: string, ownerMatch: string, localPathTemplate: string, priority: number }`. `id` is a cuid for client-side keying. `ownerMatch` is a prefix match (e.g., `jp-liu` matches `jp-liu` owner exactly, `EBG_jcjf` matches company sub-groups). `localPathTemplate` supports `{owner}` and `{repo}` interpolation (e.g., `~/project/i/{repo}`).
- **D-03:** Register `git.pathMappingRules` in `config-defaults.ts` with `defaultValue: []` (empty array — no rules configured by default). The current hardcoded rules in `git-url.ts` become seed examples the user can add through the UI, not automatic defaults.
- **D-04:** Server actions in `config-actions.ts` are sufficient — no new actions file. Read rules via `getConfigValue<GitPathRule[]>("git.pathMappingRules", [])`, write via `setConfigValue("git.pathMappingRules", rules)`.

### Rule Matching Logic
- **D-05:** New function `matchGitPathRule(url: string, rules: GitPathRule[]): string` in `git-url.ts`. Steps: parse URL → extract host + owner → iterate rules sorted by priority (lower = higher priority) → first match returns interpolated `localPathTemplate` → no match returns empty string.
- **D-06:** `ownerMatch` uses exact match by default. Wildcard `*` matches any owner for that host. This covers both specific owner patterns and catch-all host rules.
- **D-07:** The existing `gitUrlToLocalPath` function becomes an async function that: (1) reads rules from DB via `getConfigValue`, (2) tries `matchGitPathRule`, (3) if no match, falls back to existing hardcoded logic for backward compatibility. This preserves behavior for users who haven't configured rules yet.

### Settings UI Design
- **D-08:** Replace the placeholder in `system-config.tsx` with a Git Path Mapping Rules section. UI shows a table/list of existing rules with columns: Host, Owner Match, Local Path Template, and action buttons (edit/delete).
- **D-09:** "Add Rule" button opens an inline form (not a dialog) below the table with fields: Host (text input), Owner Match (text input, placeholder: `*`), Local Path Template (text input, placeholder: `~/project/{repo}`), Priority (number input, default 0).
- **D-10:** Edit is inline — clicking edit on a row converts it to editable inputs. Save/Cancel buttons appear. Delete shows a confirmation.
- **D-11:** All UI strings use `t()` i18n calls. New translation keys under `settings.config.git.*` namespace.

### Auto-populate Integration
- **D-12:** In `top-bar.tsx`, the `handleGitUrlChange` callback calls the updated `gitUrlToLocalPath` (now async). Since this is a client component, it needs to call a server action that wraps the rule-matching logic.
- **D-13:** Create a new server action `resolveGitLocalPath(url: string): Promise<string>` in `config-actions.ts` that loads rules from DB and calls `matchGitPathRule`. Falls back to the existing hardcoded logic if no rules match.
- **D-14:** The `handleGitUrlChange` in `top-bar.tsx` becomes async: `const path = await resolveGitLocalPath(value); setLocalPath(path);`

### Claude's Discretion
- Exact table styling and layout details for the rules list
- Validation messages for invalid template patterns
- Whether to show a "test" button that previews what a sample URL would resolve to
- Transition animation when adding/editing rules

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Git URL Mapping
- `src/lib/git-url.ts` — Current hardcoded mapping logic (GITHUB_USERNAME, COMPANY_HOST, gitUrlToLocalPath, toCloneUrl, parseGitUrl)
- `src/components/layout/top-bar.tsx` — Where gitUrlToLocalPath is called during project creation (handleGitUrlChange at line 75)

### Config Infrastructure (Phase 11)
- `src/actions/config-actions.ts` — getConfigValue/setConfigValue/getConfigValues server actions
- `src/lib/config-defaults.ts` — CONFIG_DEFAULTS registry (add git.pathMappingRules entry here)
- `prisma/schema.prisma` — SystemConfig model

### Settings Page
- `src/components/settings/system-config.tsx` — Current placeholder component (replace with rules UI)
- `src/app/settings/page.tsx` — Settings page wiring
- `src/components/settings/settings-nav.tsx` — Config nav item already exists from Phase 11

### i18n
- `src/lib/i18n.tsx` — Translation keys, add settings.config.git.* namespace

### Requirements
- `.planning/REQUIREMENTS.md` — GIT-01, GIT-02 are the target requirements for this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `config-actions.ts` (getConfigValue/setConfigValue): Ready to use for reading/writing rules array
- `config-defaults.ts` (CONFIG_DEFAULTS): Add `git.pathMappingRules` entry
- `system-config.tsx`: Placeholder component to replace with rules UI
- `git-url.ts` (parseGitUrl, expandHome): Existing URL parsing utilities to reuse in matching logic
- `useI18n()` hook: Translation support ready

### Established Patterns
- Settings components: Client components with `"use client"`, useI18n, inline state management
- Server actions: `"use server"`, Prisma queries, plain object params
- Form state: Local `useState` per dialog/form (no form library)
- Inline editing: No existing pattern — this will be new, but follows React controlled inputs pattern

### Integration Points
- `src/lib/git-url.ts`: Add `matchGitPathRule` function, modify `gitUrlToLocalPath` to check rules first
- `src/actions/config-actions.ts`: Add `resolveGitLocalPath` server action
- `src/lib/config-defaults.ts`: Add `git.pathMappingRules` default entry
- `src/components/settings/system-config.tsx`: Replace placeholder with rules CRUD UI
- `src/components/layout/top-bar.tsx`: Update `handleGitUrlChange` to use async `resolveGitLocalPath`
- `src/lib/i18n.tsx`: Add translation keys

</code_context>

<specifics>
## Specific Ideas

- The current hardcoded rules serve as examples: `code.iflytek.com → ~/company/{path}`, `github.com/jp-liu → ~/project/i/{repo}`, `github.com/* → ~/project/f/{repo}`
- These should NOT be auto-seeded — users add them manually through the UI. The hardcoded logic remains as fallback for backward compatibility.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (auto mode).

</deferred>

---

*Phase: 12-git-path-mapping-rules*
*Context gathered: 2026-03-30*
