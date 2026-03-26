# Pitfalls Research

**Domain:** Settings functionality for Next.js 16 AI task manager (theme switching, CLI testing, prompt management)
**Researched:** 2026-03-26
**Confidence:** HIGH (core pitfalls verified against official docs and multiple community sources)

---

## Critical Pitfalls

### Pitfall 1: Theme Flash on First Load (FOUC)

**What goes wrong:**
The page renders in the default (dark) theme server-side, then after hydration JavaScript reads `localStorage` and switches to the stored theme. Users see a visible flash of the wrong theme before the correct one applies. This is especially visible when users choose "light" mode.

**Why it happens:**
The server has no access to `localStorage`. It always renders using the CSS `:root` defaults. The client then reads the stored preference and applies it — but only after hydration, which is too late to avoid the flash. The current codebase uses the same `localStorage` pattern for i18n (`src/lib/i18n.tsx` line 367), establishing a precedent for this anti-pattern.

**How to avoid:**
Use `next-themes` library which injects an inline `<script>` in `<head>` that runs synchronously before React hydrates — it reads `localStorage` and sets the `class` or `data-theme` attribute on `<html>` before any paint occurs. This is the only reliable way to avoid FOUC with class-based dark mode in Next.js.

Critical integration requirement: the existing `globals.css` already defines `@custom-variant dark (&:is(.dark *))` — this matches the `next-themes` default `class` attribute strategy. The `ThemeProvider` must be configured with `attribute="class"` to match this.

Also add `suppressHydrationWarning` to `<html>` in `src/app/layout.tsx` because `next-themes` modifies the `class` attribute after SSR, which would otherwise produce a React hydration warning.

**Warning signs:**
- Visible white or light flash before page settles on dark theme
- React console warning: "Hydration failed because the initial UI does not match what was rendered on the server"
- `dark:` Tailwind utilities not applying on first load

**Phase to address:**
Phase 1 (General Settings / Theme Switching). Must be solved in the same commit as the `ThemeProvider` is added.

---

### Pitfall 2: Theme and i18n State Duplication (Two Competing Persistence Systems)

**What goes wrong:**
The existing i18n system (`src/lib/i18n.tsx`) uses `localStorage` via React Context with `useState`. If theme is also added to a Zustand store with `persist` middleware (or another React Context), there will be two separate client-side persistence systems that can conflict — especially on first mount where both try to hydrate simultaneously. Worse, if a Zustand persisted store is introduced, it causes a known hydration mismatch error because Zustand's `persist` middleware reads `localStorage` during render (before mount), conflicting with SSR.

**Why it happens:**
Zustand's `persist` middleware with `localStorage` is not SSR-safe. On the server, Zustand initializes with default state. On the client, after hydration, it loads from `localStorage`. React detects the mismatch and throws. This is a well-documented issue (pmndrs/zustand discussion #1382, #1377).

**How to avoid:**
Use `next-themes` for theme persistence exclusively — do not add theme state to Zustand or React Context. `next-themes` handles `localStorage` without causing hydration errors through its inline script injection. The `useTheme()` hook must only be called in client components, and theme-dependent UI must check `mounted` state before rendering to avoid mismatches.

```typescript
// CORRECT: Delay theme UI until mounted
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return null; // or return a skeleton
```

**Warning signs:**
- "Hydration failed" errors after adding a Zustand persist store
- Theme toggle shows wrong value on initial render
- Settings page shows "dark" when system/light is selected

**Phase to address:**
Phase 1 (General Settings). Establish the single source of truth for theme persistence before building UI.

---

### Pitfall 3: Tailwind v4 `@custom-variant` Mismatch with next-themes Output

**What goes wrong:**
The existing `globals.css` defines `@custom-variant dark (&:is(.dark *))`. If `next-themes` is configured with `attribute="data-theme"` instead of `attribute="class"`, the dark variant will never activate — all `dark:` utilities will be silently ignored. No errors are thrown. The theme appears to "work" (toggle fires, localStorage updates) but dark styles never apply.

**Why it happens:**
Tailwind v4 removed `darkMode: "class"` from `tailwind.config.js` (which no longer exists). Dark mode is now defined entirely by the `@custom-variant` selector in CSS. The selector `(&:is(.dark *))` matches elements inside a `.dark` class on a parent — it does NOT match `[data-theme="dark"]`. The two are mutually exclusive.

**How to avoid:**
Ensure the `@custom-variant` selector in `globals.css` exactly matches `next-themes`' output. The existing codebase uses `(&:is(.dark *))`, so `next-themes` must be configured with `attribute="class"` (the default). Do NOT change the `@custom-variant` selector unless you change both simultaneously.

Current `globals.css` line 5: `@custom-variant dark (&:is(.dark *));` — this is correct for class-based dark mode. Keep it.

**Warning signs:**
- `dark:` Tailwind utilities compile but never apply at runtime
- DevTools shows the `.dark` class is NOT being set on `<html>`
- OR DevTools shows `.dark` class is set but styles don't activate

**Phase to address:**
Phase 1 (General Settings). Verify with a simple `dark:bg-white` test immediately after setup.

---

### Pitfall 4: CLI Test Blocking the Next.js Event Loop

**What goes wrong:**
`testEnvironment()` in `src/lib/adapters/claude-local/test.ts` spawns a child process with a 45-second timeout. When this is called from an API route (`/api/adapters/test`), it ties up a Node.js thread for up to 45 seconds. If the Settings page triggers this test on mount or repeatedly, it can block other requests and make the entire app unresponsive.

**Why it happens:**
The existing `runChildProcess` in `src/lib/adapters/process-utils.ts` is async (uses `spawn`, not `execSync`), so it is non-blocking at the Node.js level. However, the API route handler awaits it synchronously — if the client sends multiple requests (e.g., user clicks "Test" multiple times), multiple 45-second Claude probe processes pile up. The `MAX_CONCURRENT = 3` limit in `process-manager.ts` only applies to task executions, not to test probes.

**How to avoid:**
- Add a loading/disabled state to the "Test CLI" button immediately on click — prevent repeat requests while a test is in-progress.
- Add server-side deduplication: reject a second `/api/adapters/test` request if one is already running for the same adapter type (in-memory flag is sufficient since this is a single-user app).
- Display a clear timeout indicator (e.g., "Testing... up to 45s").
- Consider reducing the probe timeout from 45 seconds to something shorter (10-15s) since this is a connectivity test, not a production run.

**Warning signs:**
- UI "hangs" with no response for >10 seconds after clicking "Test"
- Multiple simultaneous Claude processes visible in Activity Monitor
- API route response never resolves (client-side fetch times out first)

**Phase to address:**
Phase 2 (AI Tools / CLI Environment Testing). Must add UI debouncing and server-side guard before shipping this feature.

---

### Pitfall 5: Schema Migration Breaks Existing Data (AgentPrompt.promptId Relationship)

**What goes wrong:**
The `Task` model already has a `promptId String?` field (schema line 72) but no `@relation` directive linking it to `AgentPrompt`. If `promptId` is wired up as a proper foreign key via `prisma db push`, SQLite may drop and recreate the column, silently losing all existing task data that has `promptId` values — or it may fail if existing data violates the new constraint.

**Why it happens:**
The project uses `prisma db push` instead of `prisma migrate`. As documented by Prisma, `db push` will prompt for a reset (or silently fail) when schema changes cause conflicts with existing data. Column renames, adding non-nullable fields, and adding foreign key constraints on existing nullable columns are all destructive operations that `db push` handles poorly. There is no migration history to roll back to.

**How to avoid:**
Before wiring `promptId` as a `@relation`, verify the current state: run `prisma db push --preview-feature` in dry-run first. Since `promptId` is already `String?` (nullable), adding a `@relation` should be safe as long as existing `promptId` values match real `AgentPrompt.id` values. Add a data cleanup step: set `promptId = null` on any tasks that reference non-existent prompts before running the migration.

Do NOT add `required` (non-nullable) fields to `Task` without providing default values.

**Warning signs:**
- `prisma db push` prompts "This will reset the database" — STOP and investigate before proceeding
- Error: "Foreign key constraint failed" after push
- Tasks disappear from the Kanban board after a schema push

**Phase to address:**
Phase 3 (Agent Prompt Management, specifically when connecting promptId to Task creation). Run a schema check at the start of this phase.

---

### Pitfall 6: Prompt CRUD Missing "isDefault" Consistency Enforcement

**What goes wrong:**
`AgentPrompt` has an `isDefault Boolean` field. If multiple prompts have `isDefault: true`, the system has no defined behavior for which prompt gets applied to a new task. The existing `updatePrompt` server action does not enforce single-default invariant — it lets any number of prompts be set as default simultaneously. This creates silent corruption that only manifests at task execution time.

**Why it happens:**
The existing `AgentConfig` model has the same pattern (`isDefault Boolean`) and the current settings page already handles it at the UI layer (`handleSave` in `settings/page.tsx`). But there is no database-level constraint, and the server action doesn't enforce uniqueness. The `AgentPrompt` model will inherit this same gap.

**How to avoid:**
When setting a prompt as default, wrap the operation in a transaction that first clears all other `isDefault: true` records in the same workspace scope, then sets the target record. Use `db.$transaction()` — the same pattern the MCP tools use for label replacement.

```typescript
// CORRECT
await db.$transaction([
  db.agentPrompt.updateMany({
    where: { workspaceId, isDefault: true },
    data: { isDefault: false },
  }),
  db.agentPrompt.update({
    where: { id },
    data: { isDefault: true },
  }),
]);
```

**Warning signs:**
- Multiple prompts show "default" badge simultaneously in the UI
- Different task executions pick up different prompts with no clear rule
- `getPrompts()` returns multiple records with `isDefault: true`

**Phase to address:**
Phase 3 (Agent Prompt Management). Enforce at the server action level before building the CRUD UI.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Store theme in `localStorage` via React Context (like i18n does) | Avoids new dependency | FOUC on every page load; duplicates persistence logic | Never — use next-themes instead |
| Use Zustand `persist` for theme state | Familiar pattern already in codebase | Known SSR hydration mismatch in Next.js App Router | Never for SSR-rendered preferences |
| Skip `mounted` check in theme toggle UI | Simpler code | Hydration warning in console; potential flicker | Never in SSR context |
| Trigger CLI test on Settings page mount automatically | Instant feedback | Blocks requests; makes load time 45+ seconds | Never — user-initiated only |
| `prisma db push` for new schema fields | Fast iteration | Cannot rollback; data loss on destructive changes | Acceptable in development only; document risk |
| Inline all prompt text in task creation form | No extra network call | Long prompts make form unusable; no reuse | Never for prompts >200 chars |
| Skip `isDefault` transaction wrapping | Simpler code | Multiple "default" prompts cause silent misuse | Never |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `next-themes` + Tailwind v4 | Use `attribute="data-theme"` without updating `@custom-variant` | Match: use `attribute="class"` (default) with existing `@custom-variant dark (&:is(.dark *))` |
| `next-themes` + Next.js 16 App Router | Wrap `ThemeProvider` in a Server Component | `ThemeProvider` must be in a `"use client"` wrapper component inserted into the root layout |
| `next-themes` + `<html>` tag | Forget `suppressHydrationWarning` on `<html>` | Add `suppressHydrationWarning` to `<html>` in `src/app/layout.tsx` — next-themes modifies it |
| CLI test API route | No timeout feedback in UI | Show elapsed time and cancel option for tests that take >5 seconds |
| `AgentPrompt` + Task creation | Pass full prompt content in form payload | Store only `promptId` in task; fetch content in stream route (already done in `stream/route.ts`) |
| `AgentPrompt` + i18n | No translation keys for prompt names/descriptions | Prompt names are user-defined data — do NOT put them in the translation table |
| Prompt editor (textarea) | Use `contenteditable` div for formatting | Use `<textarea>` — prompts are plain text, not rich HTML; `contenteditable` adds XSS risk |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| CLI test called on Settings page mount | Settings page takes 45+ seconds to load | Only call `testEnvironment()` on explicit user action (button click) | Every page visit |
| Loading ALL prompts for every workspace on task create | Task creation modal is slow when many prompts exist | Limit prompt list to 50 with a search; the current data model supports `workspaceId` scoping | At ~100+ prompts per workspace |
| Theme toggle re-renders entire layout | Noticeable UI lag on toggle | Ensure `ThemeProvider` wraps the layout at root level; avoid re-creating contexts on theme change | Immediately, with large component trees |
| `testEnvironment()` spawns a real Claude process on every click | System CPU/memory spikes | Add a cooldown: disable button for 30 seconds after a test run | After 2-3 rapid clicks |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Rendering prompt `content` as HTML | XSS — prompts are user-controlled text that could contain `<script>` tags if rendered with `dangerouslySetInnerHTML` | Always render prompt content as plain text in `<pre>` or `<textarea>` — never as HTML |
| Passing prompt content via URL params | Prompt content is visible in browser history and server logs | Prompts are stored in DB by ID; only pass `promptId` in URLs/forms |
| No length validation on prompt content | Extremely long prompts exhaust Claude context window and slow execution | `prompt-actions.ts` already enforces `MAX_PROMPT_CONTENT_LENGTH = 100_000` — enforce same limit in UI before submit |
| Exposing `testEnvironment()` to any caller | In a multi-user scenario, anyone can run arbitrary process spawns | Already gated to registered `localPath` values in `/api/adapters/test/route.ts` — preserve this check |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No "system" option in theme picker | Users with OS-level dark mode can't use it; must manually re-configure if they change OS settings | Provide three options: Light, Dark, System (uses `prefers-color-scheme`) |
| Showing raw theme value ("dark") in toggle instead of resolved theme | When system theme is active, button says "dark" not "system" | Distinguish `theme` (stored preference) from `resolvedTheme` (actual applied) — use `resolvedTheme` for display |
| Theme change takes effect only after save | Users expect instant feedback | Apply theme change immediately on selection (optimistic update) — persist on change, not on separate save button |
| CLI test shows binary pass/fail | No actionable info when it fails | Show per-check results (command found, API key, hello probe) — already structured this way in `TestResult.checks` |
| Prompt editor loses unsaved changes on navigation | Frustrating data loss | Add `beforeunload` guard or autosave draft to `sessionStorage` when prompt content is modified |
| No confirmation before deleting a prompt used by tasks | Tasks silently lose their associated prompt | Before `deletePrompt`, query `Task.count({ where: { promptId: id } })` and show warning if > 0 |

---

## "Looks Done But Isn't" Checklist

- [ ] **Theme switching:** Verify no flash on hard refresh in light mode — test with `localStorage.setItem("theme", "light")` then reload
- [ ] **Theme switching:** Verify "System" option responds when OS theme changes (open DevTools > Rendering > Emulate CSS media feature `prefers-color-scheme`)
- [ ] **Theme switching:** Verify `suppressHydrationWarning` on `<html>` — check React DevTools console for hydration warnings
- [ ] **CLI testing:** Verify "Test" button is disabled during the test (no double-submit)
- [ ] **CLI testing:** Verify the UI shows per-check results, not just overall pass/fail
- [ ] **CLI testing:** Verify that a 45-second timeout surfaces an error message, not a silent spinner forever
- [ ] **Prompt CRUD:** Verify deleting a prompt used by tasks shows a warning (or tasks handle null promptId gracefully)
- [ ] **Prompt CRUD:** Verify only one prompt per workspace can be `isDefault: true` — test by setting two as default via direct action calls
- [ ] **Prompt CRUD:** Verify `promptId` on Task is still `null` safe — existing tasks without prompts must continue to execute
- [ ] **Task creation prompt selector:** Verify selecting "no prompt" (null) still works after prompt selection UI is added
- [ ] **i18n coverage:** All new Settings UI strings have both `zh` and `en` translations in `src/lib/i18n.tsx`
- [ ] **Schema migration:** Run `prisma db push` and confirm no "reset database" prompt appears

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Theme flash shipped to users | LOW | Add `next-themes` inline script injection — one-commit fix; no data migration needed |
| Zustand hydration mismatch | LOW | Remove theme from Zustand store; delegate to `next-themes` |
| Tailwind dark: utilities not working | LOW | Verify `@custom-variant` selector matches `next-themes` attribute output; check class on `<html>` in DevTools |
| Multiple default prompts in DB | MEDIUM | Run a one-time cleanup: `UPDATE AgentPrompt SET isDefault = false WHERE id NOT IN (SELECT id FROM AgentPrompt WHERE isDefault = true ORDER BY createdAt LIMIT 1)` per workspace |
| Schema push caused data loss | HIGH | Restore from `prisma/dev.db` backup (the `.db-shm` / `.db-wal` files in gitignore suggest WAL mode — use SQLite backup before any push) |
| CLI test hangs entire settings page | LOW | Add `AbortController` to the fetch call with 60-second client timeout; add server-side check to reject concurrent requests |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Theme FOUC | Phase 1: General Settings | Hard refresh in light mode — no flash |
| Theme/i18n state duplication | Phase 1: General Settings | No Zustand store for theme; `next-themes` is single source |
| Tailwind v4 `@custom-variant` mismatch | Phase 1: General Settings | `dark:` utilities apply when `.dark` class on `<html>` |
| CLI test event loop blocking | Phase 2: AI Tools CLI Testing | Button disabled during test; no concurrent requests |
| Schema migration data loss | Phase 3: Prompt Management (start) | `db push` completes without "reset" prompt |
| Prompt `isDefault` consistency | Phase 3: Prompt Management | Only one prompt per workspace has `isDefault: true` |
| Task creation null `promptId` regression | Phase 4: Task-Prompt Integration | Existing tasks without prompts execute normally |

---

## Sources

- [next-themes GitHub — zero-flash implementation details](https://github.com/pacocoursey/next-themes)
- [Tailwind CSS v4 Dark Mode — official docs](https://tailwindcss.com/docs/dark-mode)
- [Next.js + Tailwind v4 dark mode class not applying](https://www.sujalvanjare.com/blog/fix-dark-class-not-applying-tailwind-css-v4)
- [Theme colors with Tailwind v4 and next-themes](https://medium.com/@kevstrosky/theme-colors-with-tailwind-css-v4-0-and-next-themes-dark-light-custom-mode-36dca1e20419)
- [Next.js + Zustand localStorage hydration mismatch (pmndrs/zustand #1382)](https://github.com/pmndrs/zustand/discussions/1382)
- [Fixing Zustand persist hydration errors](https://medium.com/@judemiracle/fixing-react-hydration-errors-when-using-zustand-persist-with-usesyncexternalstore-b6d7a40f2623)
- [Prisma db push vs migrate — official docs](https://www.prisma.io/docs/orm/prisma-migrate/workflows/prototyping-your-schema)
- [Node.js Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [suppressHydrationWarning and theme providers — Next.js hydration error docs](https://nextjs.org/docs/messages/react-hydration-error)
- [React rich text editor XSS prevention — Syncfusion](https://www.syncfusion.com/blogs/post/react-rich-text-editor-xss-prevention)
- Codebase analysis: `src/lib/adapters/claude-local/test.ts`, `src/lib/i18n.tsx`, `src/app/settings/page.tsx`, `prisma/schema.prisma`, `src/app/globals.css`
- `.planning/codebase/CONCERNS.md` — existing tech debt and fragile areas

---
*Pitfalls research for: Settings features in Next.js 16 + Tailwind v4 AI task manager*
*Researched: 2026-03-26*
