# Project Research Summary

**Project:** ai-manager Settings Milestone
**Domain:** Settings page refactor — theme switching, CLI verification, agent prompt management
**Researched:** 2026-03-26
**Confidence:** HIGH

## Executive Summary

This is a focused settings page milestone on a well-established Next.js 16 + Tailwind v4 + Prisma 6 stack. The work is additive — the underlying models (`AgentPrompt`, `Task.promptId`), server actions (`prompt-actions.ts`), and adapter test infrastructure (`testEnvironment()`) already exist. The milestone's job is to surface this backend capability through new and updated UI components. The recommended approach is a four-phase build: (1) theme infrastructure, (2) general settings panel, (3) CLI adapter verification, and (4) prompt CRUD + task integration. Only one new dependency is needed: `next-themes ^0.4.6`.

The single highest-priority risk is the Tailwind v4 `@custom-variant` selector incompatibility with `next-themes`. The existing `globals.css` uses `(&:is(.dark *))`, which does not match the `<html>` element itself — meaning dark mode will appear completely broken after `next-themes` is installed until the selector is changed to `(&:where(.dark, .dark *))`. This must be fixed as part of Phase 1 before any other work begins. The second risk is the CLI test probe taking up to 45 seconds — it must be user-initiated only (button click), never triggered on page mount.

The research is grounded entirely in codebase analysis of the actual source files, not training-data assumptions. All confidence ratings are HIGH. The only open design question is whether the light theme CSS variable set needs to be defined — the current codebase has only one CSS theme (Midnight Studio dark). Without a light theme design, the theme toggle will switch to an unstyled state. This needs product decision before Phase 1 ships.

## Key Findings

### Recommended Stack

The stack is locked. The project runs on Next.js 16.2.1 App Router, React 19.2.4, Tailwind v4 (postcss), Zustand 5.0.12, and Prisma 6. No additions are required except `next-themes ^0.4.6` for SSR-safe theme switching.

The existing i18n system (`src/lib/i18n.tsx` — flat React Context + localStorage) is sufficient and does not need replacement. All prompt CRUD server actions exist in `src/actions/prompt-actions.ts`. The CLI adapter test is implemented in `src/lib/adapters/claude-local/test.ts`. The `Task.promptId` field already exists in the Prisma schema — no schema migration is required for prompt-task linkage; only the server action and UI need updating.

**Core technologies:**
- `next-themes ^0.4.6`: SSR-safe dark mode — the only way to avoid FOUC in Next.js App Router; handles `localStorage`, `prefers-color-scheme`, and `<html>` class injection atomically
- Existing `prompt-actions.ts`: full CRUD for `AgentPrompt` — no new backend work needed
- Existing `/api/adapters/test` route: bridge to `testEnvironment()` — must be used via `fetch()` from the client, not via Server Action, due to 45-second blocking potential
- Existing `I18nProvider` (React Context): extend with new translation keys only — no library change

**Critical version requirement:** `next-themes ^0.4.6` requires `suppressHydrationWarning` on `<html>` in `layout.tsx`. It also requires updating the `@custom-variant dark` selector in `globals.css` from `(&:is(.dark *))` to `(&:where(.dark, .dark *))`.

### Expected Features

**Must have (table stakes):**
- Language toggle (zh/en) in a new General settings section — existing `setLocale()` only needs a UI control
- Theme toggle (light/dark/system) with `localStorage` persistence and no FOUC
- CLI connection test button with per-check result display (`claude_command_resolvable`, `anthropic_api_key`, `claude_hello_probe`)
- Agent Prompt CRUD: list, create (name + description + content + isDefault), edit, delete with confirmation
- Prompt selector in `CreateTaskDialog` with auto-selection of the default prompt
- i18n coverage for all new strings in both `zh` and `en` maps

**Should have (differentiators):**
- Per-check CLI test results with actionable messages (not just pass/fail summary)
- Default prompt auto-selection at task creation time using `AgentPrompt.isDefault`
- `isDefault` enforced as a single-per-workspace invariant via Prisma transaction
- Warning before deleting a prompt used by existing tasks

**Defer (v2+):**
- Workspace-scoped vs. global prompt scoping in the UI (`workspaceId` filtering)
- Prompt selector in the edit task dialog (create path must be validated first)
- Additional adapter support (MINIMAX has no adapter yet)
- Prompt export/import for sharing between installations

### Architecture Approach

The three new features slot cleanly into the existing layered architecture: presentation components in `src/components/settings/` call server actions in `src/actions/` which call Prisma, with one new API route (`/api/adapters/[type]/test/route.ts`) bridging the client to the adapter layer. Theme state lives entirely client-side in `localStorage` via a new `ThemeProvider`, mirroring the existing `I18nProvider` pattern. No new architectural patterns are introduced; the milestone extends existing patterns.

**Major components:**

1. `src/lib/theme.ts` (NEW) — `ThemeProvider` React Context + `useTheme` hook; reads/writes `localStorage["theme"]`; applies `dark` class to `document.documentElement`
2. `src/components/settings/general-config.tsx` (NEW) — language + theme preference UI; calls `useI18n().setLocale()` and `useTheme().setTheme()`
3. `src/components/settings/prompts-config.tsx` (NEW) — full CRUD UI for `AgentPrompt`; calls existing `prompt-actions.ts` server actions directly
4. `src/app/api/adapters/[type]/test/route.ts` (NEW) — GET handler; calls `getAdapter(type).testEnvironment(cwd)`; returns `TestResult` JSON
5. `src/components/settings/ai-tools-config.tsx` (MODIFY) — replaces static hardcoded banner with a "Test Connection" button + per-check result list
6. `src/components/settings/settings-nav.tsx` (MODIFY) — adds "General" and "Prompts" nav items
7. `src/components/board/create-task-dialog.tsx` (MODIFY) — adds prompt selector; pre-selects `isDefault` prompt; passes `promptId` through `onSubmit`
8. `src/actions/task-actions.ts` (MODIFY) — extends `createTask` to accept and persist `promptId?: string`

### Critical Pitfalls

1. **Tailwind v4 `@custom-variant` mismatch with next-themes** — the existing `(&:is(.dark *))` selector does not match the `<html>` element itself, so dark mode never activates after `next-themes` sets `class="dark"` on `<html>`. Fix: change line 5 in `globals.css` to `@custom-variant dark (&:where(.dark, .dark *))`. Must be the very first change in Phase 1. Verify by adding `dark:bg-white` to a test element and confirming it applies.

2. **Theme FOUC (Flash of Unstyled Content)** — rendering server-side without theme, then applying it after hydration, causes a visible flash. Prevention: use `next-themes` (not a manual `useEffect` + localStorage approach) — it injects an inline `<script>` in `<head>` that applies the class before any paint. Also add `suppressHydrationWarning` to `<html>`.

3. **CLI test blocking on page mount** — `testEnvironment()` spawns a child process with a 45-second timeout. Triggering it automatically on settings page load will make the page unusable. Prevention: on-demand button only; disable button during test; add server-side deduplication guard to reject concurrent test requests for the same adapter.

4. **`isDefault` consistency violation** — multiple prompts can be set as default simultaneously because no DB constraint enforces uniqueness. Prevention: wrap the "set as default" operation in a `db.$transaction()` that first clears all other `isDefault: true` records for the same workspace, then sets the target record.

5. **Schema migration data loss** — `prisma db push` on destructive changes prompts a database reset. Prevention: before wiring `Task.promptId` as a `@relation`, verify no existing task data has orphaned `promptId` values; run cleanup (`SET promptId = null`) before pushing. Never run `db push` when it says "This will reset the database" without understanding the data impact.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Theme Infrastructure + General Settings
**Rationale:** Theme support is a pure infrastructure change with no feature dependencies. It must come first because every subsequent phase will use `dark:` Tailwind utilities. The `@custom-variant` fix is a prerequisite for any theming work to function. General Settings (language + theme toggles) is the natural first deliverable that validates the infrastructure works.
**Delivers:** Working dark/light/system theme toggle with no FOUC; language toggle surfaced in settings UI; new "General" nav section
**Addresses:** Language toggle, theme toggle, persist appearance preferences (all P1 table stakes)
**Avoids:** Theme FOUC (Pitfall 1), `@custom-variant` mismatch (Pitfall 3), Zustand hydration mismatch (Pitfall 2)
**Files:** `globals.css` (modify), `src/lib/theme.ts` (new), `src/app/layout.tsx` (modify), `src/components/settings/general-config.tsx` (new), `src/components/settings/settings-nav.tsx` (modify), `src/app/settings/page.tsx` (modify), `src/lib/i18n.tsx` (add keys)

### Phase 2: CLI Adapter Verification
**Rationale:** Independent of prompt management. The adapter test infrastructure (`testEnvironment()`, the API route handler) exists; this phase only adds the UI. Isolated scope means it can be reviewed and tested without touching the prompt subsystem.
**Delivers:** "Test Connection" button in AI Tools settings section; per-check result display (command found, API key, hello probe); loading/error states; button disabled during test
**Addresses:** CLI tool status display (P1 table stakes), live CLI verification with per-check breakdown (differentiator)
**Avoids:** CLI event loop blocking (Pitfall 4) — must disable button during test and add server-side deduplication
**Files:** `src/app/api/adapters/[type]/test/route.ts` (new), `src/components/settings/ai-tools-config.tsx` (modify), `src/lib/i18n.tsx` (add keys)

### Phase 3: Agent Prompt Management (Settings CRUD)
**Rationale:** Prompt CRUD must exist before prompt selection in task creation — users need prompts before they can select them. This phase is self-contained in the settings page. All server actions exist; this is pure UI work.
**Delivers:** Full CRUD UI for `AgentPrompt`; new "Prompts" nav section; `isDefault` single-per-workspace enforcement via transaction
**Addresses:** Prompt list view, create/edit form, delete with confirmation (all P1 table stakes)
**Avoids:** `isDefault` consistency violation (Pitfall 6); prompt delete without task-usage warning (UX pitfall)
**Files:** `src/components/settings/prompts-config.tsx` (new), `src/components/settings/settings-nav.tsx` (modify), `src/app/settings/page.tsx` (modify), `src/lib/i18n.tsx` (add keys)

### Phase 4: Prompt Selection in Task Creation
**Rationale:** Depends on Phase 3 (prompts must exist). Cross-cutting change that touches the board page, task dialog, and task server action. Isolated to last phase to keep earlier phases testable without this dependency.
**Delivers:** Prompt selector in `CreateTaskDialog`; auto-selection of default prompt; `promptId` persisted to `Task` record; existing tasks without prompts continue to work (null-safe)
**Addresses:** Prompt selection during task creation, default prompt auto-selection (both P1)
**Avoids:** Schema migration data loss (Pitfall 5) — verify `Task.promptId` FK wiring is safe before `prisma db push`; null promptId regression (tasks created before this phase must still execute)
**Files:** `src/actions/task-actions.ts` (modify), `src/components/board/create-task-dialog.tsx` (modify), `src/app/workspaces/[workspaceId]/page.tsx` (modify)

### Phase Ordering Rationale

- **Infrastructure before UI:** Theme infrastructure (Phase 1) must precede everything because dark mode CSS utilities are used throughout. The `@custom-variant` bug would silently break all `dark:` styles if left unfixed.
- **Independent features before dependent features:** CLI verification (Phase 2) is fully independent — it can be built and shipped without any prompt work. Prompt selection in task creation (Phase 4) strictly depends on Prompt CRUD (Phase 3).
- **Backend-ready features first:** Phases 2, 3, and 4 all have their server-side infrastructure already in place. They are primarily UI work, which keeps implementation risk low and velocity high.
- **Pitfall sequencing:** Each phase is aligned to a pitfall cluster so that the relevant risks are identified and mitigated at the right time — not discovered in a later phase where they are harder to fix.

### Research Flags

Phases with standard patterns (no additional research needed):
- **Phase 1:** `next-themes` + Tailwind v4 integration is well-documented in multiple community guides; the exact CSS fix is verified against codebase analysis
- **Phase 2:** API Route + fetch pattern for async operations is the established Next.js pattern; adapter test infrastructure already exists
- **Phase 3:** Server Action CRUD + `revalidatePath` is the standard pattern in this codebase; all actions exist
- **Phase 4:** Props threading + Server Action signature update follows the established pattern used for labels today

No phases require deeper research during planning. All patterns have HIGH-confidence sources.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against actual `package.json`, `globals.css`, `prisma/schema.prisma` — no assumptions |
| Features | HIGH | Derived from codebase analysis of existing actions, models, and component gaps |
| Architecture | HIGH | Direct source file inspection; all integration points verified in code, not inferred |
| Pitfalls | HIGH | Core pitfalls (FOUC, `@custom-variant`, hydration) confirmed by official docs and multiple community sources; schema pitfall confirmed against Prisma docs |

**Overall confidence:** HIGH

### Gaps to Address

- **Light theme CSS variables:** The codebase has only one CSS theme (Midnight Studio dark). A light theme requires a separate CSS variable block under `.light` or `html:not(.dark)`. Without this, the theme toggle will show an unstyled white state. Product/design decision needed before Phase 1 ships. If light theme design is not ready, the toggle could default to dark-only with a "system" fallback that maps to dark.
- **`@custom-variant` fix vs. existing dark components:** Changing `(&:is(.dark *))` to `(&:where(.dark, .dark *))` affects all existing `dark:` utilities. Should be verified with a visual regression check on the Kanban board after the change to ensure no existing dark styles break.
- **MCP tool `create_task` update:** If prompt selection should be available via MCP, the `create_task` MCP tool in `src/mcp/tools/task-tools.ts` also needs a `promptId` parameter. This is out of scope for the current milestone but should be flagged for Phase 4.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/app/globals.css`, `src/lib/i18n.tsx`, `src/actions/prompt-actions.ts`, `src/actions/task-actions.ts`, `src/lib/adapters/types.ts`, `src/lib/adapters/claude-local/test.ts`, `prisma/schema.prisma`, `src/app/settings/page.tsx`, `src/components/settings/`, `src/components/board/create-task-dialog.tsx`, `src/app/layout.tsx`
- [next-themes GitHub](https://github.com/pacocoursey/next-themes) — App Router support, `attribute="class"` pattern, FOUC prevention via inline script
- [Dark Mode Next.js 15 + Tailwind v4 guide](https://www.sujalvanjare.com/blog/dark-mode-nextjs15-tailwind-v4) — confirms `@custom-variant dark (&:where(.dark, .dark *))`, `suppressHydrationWarning`, `next-themes@0.4.6`
- [Solving class-based dark mode Tailwind 4](https://iifx.dev/en/articles/456423217/solved-enabling-class-based-dark-mode-with-next-15-next-themes-and-tailwind-4) — confirms `@custom-variant` fix
- [Tailwind CSS v4 Dark Mode official docs](https://tailwindcss.com/docs/dark-mode) — `@custom-variant` directive specification
- [Prisma db push vs migrate docs](https://www.prisma.io/docs/orm/prisma-migrate/workflows/prototyping-your-schema) — destructive change behavior

### Secondary (MEDIUM confidence)
- [Next.js + Zustand localStorage hydration mismatch (pmndrs/zustand #1382)](https://github.com/pmndrs/zustand/discussions/1382) — Zustand `persist` SSR incompatibility
- [Node.js Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop) — async child process guidance
- [React rich text editor XSS prevention](https://www.syncfusion.com/blogs/post/react-rich-text-editor-xss-prevention) — prompt content rendering safety

---
*Research completed: 2026-03-26*
*Ready for roadmap: yes*
