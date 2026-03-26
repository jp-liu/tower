# Architecture Research

**Domain:** Settings features in existing Next.js 16 AI task manager
**Researched:** 2026-03-26
**Confidence:** HIGH (derived entirely from direct codebase analysis — no training assumptions)

---

## Existing Architecture at a Glance

```
src/app/layout.tsx  (Server Component)
  └── I18nProvider  (Client Context — locale in localStorage)
      └── LayoutClient
          └── pages/settings/page.tsx  (Client Component — currently "use client")
              ├── SettingsNav           (left nav, section switcher)
              └── AIToolsConfig         (active section = "ai-tools")
                  skills / plugins      (placeholder divs)

src/actions/
  agent-config-actions.ts   (AgentConfig CRUD)
  prompt-actions.ts         (AgentPrompt CRUD — already exists)
  task-actions.ts           (createTask, updateTask — no promptId today)

src/lib/adapters/
  types.ts          (AdapterModule interface: execute + testEnvironment)
  registry.ts       (Map<string, AdapterModule>)
  claude-local/     (only adapter today)

src/lib/
  i18n.tsx          (React Context, localStorage["locale"], flat key-value dict)

prisma/schema.prisma
  AgentPrompt       (id, name, description, content, isDefault, workspaceId)
  Task.promptId     (String? — field exists in schema, NOT in createTask action yet)
  AgentConfig       (id, agent, configName, appendPrompt, settings, isDefault)
```

---

## Standard Architecture for New Features

### System Overview

The three new Settings features slot into the existing architecture at different layers:

```
┌────────────────────────────────────────────────────────────────────┐
│  PRESENTATION LAYER  src/components/settings/                      │
│                                                                    │
│  [SettingsNav]  [GeneralConfig]  [AIToolsConfig*]  [PromptsConfig] │
│      (mod)          (NEW)            (mod)              (NEW)      │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ Server Actions / direct import
┌──────────────────────────────▼─────────────────────────────────────┐
│  SERVER ACTIONS  src/actions/                                      │
│                                                                    │
│  prompt-actions.ts  (exists — CRUD ready)                          │
│  agent-config-actions.ts  (exists — no testEnvironment call)       │
│  task-actions.ts  (mod — add promptId to createTask)               │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│  API ROUTES  src/app/api/                                          │
│                                                                    │
│  /api/adapters/[type]/test  (NEW — calls testEnvironment)          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│  ADAPTER LAYER  src/lib/adapters/                                  │
│                                                                    │
│  types.ts (unchanged)  registry.ts (unchanged)                     │
│  claude-local/ (testEnvironment already implemented)               │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│  CROSS-CUTTING  src/lib/                                           │
│                                                                    │
│  i18n.tsx — add theme/appearance keys (mod)                        │
│  theme.ts  — NEW: localStorage bridge + CSS var applicator         │
└────────────────────────────────────────────────────────────────────┘
```

---

## Feature-by-Feature Integration Analysis

### Feature 1: Theme Switching (General Settings)

**Integration point:** `src/lib/i18n.tsx` + `src/app/layout.tsx` + new `src/lib/theme.ts`

**What exists:**
- `I18nProvider` in `src/lib/i18n.tsx` already persists locale to `localStorage["locale"]` and exposes `setLocale` via React Context.
- `src/app/layout.tsx` hardcodes `<html lang="zh-CN">` — no theme class today.
- No `ThemeProvider` or dark mode CSS variables exist.

**What needs to be built:**

1. **`src/lib/theme.ts`** (NEW) — a thin client-side module that:
   - Reads/writes `localStorage["theme"]` (`"light"` | `"dark"` | `"system"`)
   - Applies a CSS class (`dark`) to `document.documentElement`
   - Exports a `ThemeProvider` React Context component

2. **`src/app/layout.tsx`** (MODIFY) — wrap children in `ThemeProvider` alongside `I18nProvider`. Add a `suppressHydrationWarning` on `<html>` to avoid hydration mismatch (standard pattern for theme-on-body/html).

3. **`src/components/settings/general-config.tsx`** (NEW) — the "General" settings panel. Displays:
   - Language switcher (calls existing `setLocale` from `useI18n()`)
   - Theme switcher (calls new `setTheme` from `useTheme()`)

4. **`src/components/settings/settings-nav.tsx`** (MODIFY) — add a "general" nav item at the top of `NAV_ITEMS`.

5. **`src/app/settings/page.tsx`** (MODIFY) — add `activeSection === "general"` branch rendering `<GeneralConfig />`.

**Data flow:**
```
User clicks theme toggle
  → GeneralConfig calls setTheme("dark")
  → ThemeProvider writes localStorage["theme"] = "dark"
  → ThemeProvider adds class "dark" to document.documentElement
  → Tailwind dark: variants activate (requires darkMode: "class" in tailwind.config)
  → Page re-renders with dark styles (no server round-trip needed)
```

**Schema changes:** None. Theme preference is client-only (localStorage), consistent with how locale is handled today.

**i18n additions:** Add keys under `settings.*` prefix: `settings.general`, `settings.theme`, `settings.themeLight`, `settings.themeDark`, `settings.themeSystem`.

---

### Feature 2: CLI Adapter Testing (AI Tools — testEnvironment)

**Integration point:** `src/lib/adapters/types.ts` → new API Route → `AIToolsConfig` component

**What exists:**
- `AdapterModule.testEnvironment(cwd: string): Promise<TestResult>` is defined in `types.ts` and implemented in the `claude-local` adapter.
- `AIToolsConfig` currently shows a static hardcoded green "检测到最近使用" banner — not a real check.
- The adapter registry (`registry.ts`) is server-side only (Node.js `child_process`). It cannot be imported by a Client Component.

**What needs to be built:**

1. **`src/app/api/adapters/[type]/test/route.ts`** (NEW) — a `GET` or `POST` Route Handler that:
   - Accepts `type` path param (e.g., `"CLAUDE_CODE"`)
   - Accepts optional `cwd` body/query param (defaults to `process.cwd()`)
   - Calls `getAdapter(type).testEnvironment(cwd)`
   - Returns `TestResult` JSON

2. **`src/components/settings/ai-tools-config.tsx`** (MODIFY) — replace the static banner with:
   - A "Test Connection" button per adapter
   - Calls `fetch("/api/adapters/CLAUDE_CODE/test")` on click
   - Shows a loading state, then renders `TestResult.checks` (name + passed + message per check)
   - Status badge: green for all-pass, red for any-fail

**Data flow:**
```
User clicks "Test Connection"
  → AIToolsConfig fetches /api/adapters/CLAUDE_CODE/test
  → Route Handler calls getAdapter("CLAUDE_CODE").testEnvironment(cwd)
  → claude-local adapter runs shell checks (e.g., `claude --version`)
  → Returns { ok: boolean, checks: TestCheck[] }
  → Component renders check list inline
```

**Why API Route (not Server Action):** `testEnvironment` spawns child processes and may take seconds — server actions are designed for fast mutations. An API route allows proper loading state management on the client. Also, the adapter imports (`child_process`) are Node.js-only and cannot run in the browser.

**Schema changes:** None.

**i18n additions:** `settings.testConnection`, `settings.testPassed`, `settings.testFailed`, `settings.testing`.

---

### Feature 3: Agent Prompt Management (Prompts Section)

**Integration point:** `src/actions/prompt-actions.ts` → new `PromptsConfig` component → `CreateTaskDialog`

**What exists:**
- `AgentPrompt` model in Prisma schema is complete.
- `src/actions/prompt-actions.ts` implements full CRUD: `getPrompts`, `getPromptById`, `createPrompt`, `updatePrompt`, `deletePrompt`.
- `Task.promptId` field exists in schema but `createTask` in `task-actions.ts` does not accept or persist it yet.
- `CreateTaskDialog` has no prompt selector UI.

**What needs to be built:**

1. **`src/components/settings/prompts-config.tsx`** (NEW) — the "Prompts" settings panel:
   - Lists all `AgentPrompt` records (calls `getPrompts()`)
   - Create new prompt: name, description, content (textarea), isDefault toggle
   - Edit existing prompt: inline or modal editor
   - Delete prompt (with confirmation)
   - Mark/unmark as default
   - Uses `createPrompt`, `updatePrompt`, `deletePrompt` server actions directly

2. **`src/components/settings/settings-nav.tsx`** (MODIFY) — add a "prompts" nav item.

3. **`src/app/settings/page.tsx`** (MODIFY) — add `activeSection === "prompts"` branch rendering `<PromptsConfig />`. Prompts are global (no `workspaceId` filter needed in the settings context).

4. **`src/actions/task-actions.ts`** (MODIFY) — extend `createTask` to accept optional `promptId?: string` and persist it to the `Task` record.

5. **`src/components/board/create-task-dialog.tsx`** (MODIFY) — add a prompt selector:
   - New prop: `prompts: { id: string; name: string; isDefault: boolean }[]`
   - New state: `selectedPromptId: string | null` (pre-fills with default prompt's id)
   - Renders a `<Select>` or button group for prompt selection (optional — clear/"none" option available)
   - Passes `promptId` to `onSubmit`

6. **`src/app/workspaces/[workspaceId]/page.tsx` or the board page client** (MODIFY) — fetch prompts and pass to `CreateTaskDialog`. The board page already receives workspace data; add a `getPrompts(workspaceId)` call.

**Data flow (prompt selection at task creation):**
```
Board page (Server Component) fetches prompts via getPrompts(workspaceId)
  → passes prompts[] to BoardPageClient
  → BoardPageClient passes prompts[] to CreateTaskDialog
  → User selects a prompt (or keeps default)
  → onSubmit includes promptId
  → createTask server action persists promptId to Task record
```

**Data flow (prompt management in Settings):**
```
User opens /settings → clicks "Prompts" nav item
  → PromptsConfig calls getPrompts() (server action, no workspaceId filter)
  → User creates/edits/deletes prompts
  → Server actions call revalidatePath("/settings") and revalidatePath("/workspaces")
  → Next time board page loads, fresh prompts are available
```

**Schema changes:** None needed (schema already has `AgentPrompt` and `Task.promptId`).

**i18n additions:** `settings.prompts`, `settings.promptName`, `settings.promptContent`, `settings.promptDescription`, `settings.promptDefault`, `settings.promptCreate`, `settings.promptEdit`, `settings.promptDelete`, `task.prompt`, `task.promptNone`.

---

## Component Responsibilities

| Component | Status | Responsibility |
|-----------|--------|----------------|
| `settings-nav.tsx` | MODIFY | Add "general" and "prompts" nav items |
| `settings/page.tsx` | MODIFY | Route to GeneralConfig and PromptsConfig sections |
| `general-config.tsx` | NEW | Language + theme preference UI |
| `ai-tools-config.tsx` | MODIFY | Replace static banner with live testEnvironment call |
| `prompts-config.tsx` | NEW | Full CRUD UI for AgentPrompt records |
| `create-task-dialog.tsx` | MODIFY | Add prompt selector field |
| `src/lib/theme.ts` | NEW | ThemeProvider, useTheme hook, localStorage bridge |
| `src/app/layout.tsx` | MODIFY | Wrap in ThemeProvider, add suppressHydrationWarning |
| `/api/adapters/[type]/test/route.ts` | NEW | Bridge client → server adapter testEnvironment |
| `task-actions.ts` | MODIFY | Accept promptId in createTask |
| `tailwind.config.*` | MODIFY | Set darkMode: "class" |

---

## Recommended File Structure Changes

```
src/
├── app/
│   ├── api/
│   │   └── adapters/
│   │       └── [type]/
│   │           └── test/
│   │               └── route.ts        # NEW — adapter test endpoint
│   ├── settings/
│   │   └── page.tsx                    # MODIFY — add general + prompts sections
│   └── layout.tsx                      # MODIFY — add ThemeProvider
├── components/
│   └── settings/
│       ├── settings-nav.tsx            # MODIFY — add general + prompts items
│       ├── ai-tools-config.tsx         # MODIFY — live test connection
│       ├── general-config.tsx          # NEW — theme + language
│       └── prompts-config.tsx          # NEW — prompt CRUD
├── actions/
│   └── task-actions.ts                 # MODIFY — add promptId to createTask
└── lib/
    └── theme.ts                        # NEW — ThemeProvider + useTheme
```

---

## Architectural Patterns

### Pattern 1: localStorage-Persisted Client Context (Theme)

**What:** React Context holds a preference value that is initialized from `localStorage` on mount and synced back on change. No server involvement.

**When to use:** UI preferences that do not affect server-rendered content (theme class on `<html>`, locale switching). Consistent with how `I18nProvider` handles locale today.

**Trade-offs:** Simple and zero-latency. Causes a flash-of-unstyled-content on first load if not paired with an inline script that applies the class before React hydrates. For this app (localhost dev tool), the flash is acceptable — avoid the complexity of script injection.

**Example:**
```typescript
// src/lib/theme.ts
"use client";
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window !== "undefined"
      ? (localStorage.getItem("theme") as Theme) ?? "system"
      : "system"
  );
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("theme", theme);
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>{children}</ThemeContext.Provider>;
}
```

### Pattern 2: API Route for Async Server-Side Operations

**What:** Client Component triggers a `fetch()` to a Next.js Route Handler when the operation is long-running, has complex return data, or requires loading state management.

**When to use:** `testEnvironment()` — spawns a child process, may take 1-3s, returns structured check results. Server Actions are designed for fast mutations; using one here would block the UI without a clean loading state.

**Trade-offs:** Slightly more boilerplate than a Server Action. Enables proper loading/error states and `AbortController` cancellation. Consistent with how SSE streaming uses Route Handlers today.

**Example:**
```typescript
// src/app/api/adapters/[type]/test/route.ts
export async function GET(req: Request, { params }: { params: { type: string } }) {
  try {
    const adapter = getAdapter(params.type);
    const result = await adapter.testEnvironment(process.cwd());
    return Response.json(result);
  } catch (e) {
    return Response.json({ ok: false, checks: [], error: String(e) }, { status: 500 });
  }
}
```

### Pattern 3: Server Action CRUD with revalidatePath

**What:** Server Actions call Prisma, then call `revalidatePath()` to invalidate Next.js cache. Client Components call the action directly via import.

**When to use:** All prompt management operations. `prompt-actions.ts` already follows this pattern exactly. New UI components (`PromptsConfig`) call these actions directly — no additional abstraction needed.

**Trade-offs:** Zero boilerplate vs REST API. The broad `revalidatePath("/workspaces")` + `revalidatePath("/settings")` strategy already in `prompt-actions.ts` covers all consumers. No change needed.

---

## Data Flow

### Theme Switching

```
User clicks theme toggle in GeneralConfig
  → useTheme().setTheme("dark")
  → ThemeProvider useEffect: document.documentElement.classList.add("dark")
  → ThemeProvider: localStorage["theme"] = "dark"
  → Tailwind dark: variants activate via CSS class
  → No server round-trip
```

### CLI Adapter Test

```
User clicks "Test Connection" in AIToolsConfig
  → fetch("/api/adapters/CLAUDE_CODE/test") [with loading state]
  → Route Handler: getAdapter("CLAUDE_CODE").testEnvironment(cwd)
  → claude-local adapter: spawns "claude --version", checks PATH, etc.
  → Returns TestResult { ok, checks[] }
  → AIToolsConfig renders check list with pass/fail icons
```

### Prompt Management (Settings)

```
PromptsConfig mounts
  → calls getPrompts() server action (no workspaceId filter)
  → renders list of AgentPrompt records
User creates prompt → createPrompt({name, content, ...})
  → Prisma insert
  → revalidatePath("/settings"), revalidatePath("/workspaces")
  → PromptsConfig re-fetches (router.refresh() or re-call server action)
```

### Prompt Selection at Task Creation

```
Board Server Component: getPrompts(workspaceId) → passes prompts to client
  → BoardPageClient → CreateTaskDialog receives prompts prop
  → pre-selects prompt where isDefault = true
User submits task → onSubmit({ ..., promptId })
  → createTask({ ..., promptId }) server action
  → Prisma: Task.promptId = promptId
```

---

## Integration Points

### New vs. Modified (summary)

| File | New/Modified | Why |
|------|-------------|-----|
| `src/lib/theme.ts` | NEW | ThemeProvider context does not exist |
| `src/app/layout.tsx` | MODIFY | Add ThemeProvider, suppressHydrationWarning |
| `tailwind.config.*` | MODIFY | Enable `darkMode: "class"` |
| `src/components/settings/general-config.tsx` | NEW | New settings panel |
| `src/components/settings/prompts-config.tsx` | NEW | New settings panel |
| `src/components/settings/settings-nav.tsx` | MODIFY | Add general + prompts items |
| `src/app/settings/page.tsx` | MODIFY | Route to new panels |
| `src/components/settings/ai-tools-config.tsx` | MODIFY | Live test connection |
| `src/app/api/adapters/[type]/test/route.ts` | NEW | testEnvironment bridge |
| `src/actions/task-actions.ts` | MODIFY | Accept promptId in createTask |
| `src/components/board/create-task-dialog.tsx` | MODIFY | Add prompt selector |
| `src/app/workspaces/[workspaceId]/page.tsx` | MODIFY | Fetch prompts, pass to board |
| `src/lib/i18n.tsx` | MODIFY | Add new translation keys |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| GeneralConfig ↔ ThemeProvider | React Context (useTheme hook) | Same pattern as I18nProvider |
| GeneralConfig ↔ I18nProvider | React Context (useI18n hook, setLocale) | Already works, just surface in new component |
| AIToolsConfig ↔ Adapter Layer | HTTP fetch to API Route | Cannot import adapter directly in client |
| PromptsConfig ↔ prompt-actions.ts | Server Action direct import | Standard pattern, already exists |
| CreateTaskDialog ↔ Prompts | Props (prompts array passed from parent) | Consistent with how labels are passed today |
| Settings ↔ Board (prompt data) | revalidatePath + router.refresh | Standard cache invalidation pattern |

---

## Suggested Build Order

Dependencies drive this order — each step unblocks the next.

**Step 1: Tailwind + ThemeProvider infrastructure** (no dependencies)
- `tailwind.config.*`: add `darkMode: "class"`
- `src/lib/theme.ts`: ThemeProvider + useTheme hook
- `src/app/layout.tsx`: wrap in ThemeProvider

**Step 2: General Settings panel** (depends on Step 1)
- `src/lib/i18n.tsx`: add general/theme translation keys
- `src/components/settings/general-config.tsx`: theme + language switcher
- `src/components/settings/settings-nav.tsx`: add "general" item
- `src/app/settings/page.tsx`: add general section branch

**Step 3: CLI Adapter Test** (depends on existing adapter layer — no new deps)
- `src/app/api/adapters/[type]/test/route.ts`: new Route Handler
- `src/components/settings/ai-tools-config.tsx`: replace static banner with live test

**Step 4: Prompt Management in Settings** (depends on existing prompt-actions.ts)
- `src/lib/i18n.tsx`: add prompt translation keys
- `src/components/settings/prompts-config.tsx`: CRUD UI
- `src/components/settings/settings-nav.tsx`: add "prompts" item
- `src/app/settings/page.tsx`: add prompts section branch

**Step 5: Prompt selector in task creation** (depends on Step 4 — prompts must exist before users can select them)
- `src/actions/task-actions.ts`: add promptId to createTask
- `src/components/board/create-task-dialog.tsx`: add prompt selector
- `src/app/workspaces/[workspaceId]/page.tsx`: fetch prompts, thread down to dialog

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Calling testEnvironment from a Server Action

**What people do:** Create a `"use server"` action that calls `getAdapter(type).testEnvironment()` directly.

**Why it's wrong:** Server Actions are intended for fast data mutations. `testEnvironment` is a potentially slow operation (spawns CLI processes). More critically, there is no way to show a loading spinner while a Server Action is pending without `useFormStatus` + form submission — awkward for a "Test" button. The existing SSE streaming pattern already demonstrates the correct approach: use an API Route for long-running operations.

**Do this instead:** A `GET /api/adapters/[type]/test` Route Handler that the client fetches with a `useState` loading flag.

### Anti-Pattern 2: Server-Side Theme Resolution

**What people do:** Store theme preference in the database or session, read it in the Server Component, and pass it as a prop to layout.

**Why it's wrong:** This creates a server round-trip on every page load just for a CSS class. The existing locale system uses localStorage for the same reason — preferences that only affect the client UI belong in localStorage.

**Do this instead:** Client-only ThemeProvider with localStorage persistence, exactly mirroring `I18nProvider`.

### Anti-Pattern 3: Fetching Prompts Inside the Settings Page Client Component via useEffect

**What people do:** In a `"use client"` settings page, call `getPrompts()` inside a `useEffect` on mount.

**Why it's wrong:** This is how the current settings page fetches `AgentConfigs` (`useEffect(() => { getAgentConfigs().then(...) })`) — it works but creates a loading flash and is harder to reason about. Server Actions called from `useEffect` also bypass Suspense.

**Do this instead:** For `PromptsConfig`, prefer calling the server action in the component body using React's `use()` hook (React 19, available here) or by converting the settings page to a hybrid: keep the outer layout as a Server Component that fetches prompts, and pass them as initial props to the client `PromptsConfig`. However, since the current page is already `"use client"` and uses the `useEffect` pattern throughout, follow the existing convention to minimize churn — just be aware of the flash.

---

## Sources

- Direct codebase analysis: `src/app/settings/page.tsx`, `src/components/settings/`, `src/lib/i18n.tsx`, `src/lib/adapters/types.ts`, `src/lib/adapters/registry.ts`, `src/actions/prompt-actions.ts`, `src/actions/task-actions.ts`, `src/components/board/create-task-dialog.tsx`, `prisma/schema.prisma`, `src/app/layout.tsx`
- All findings are HIGH confidence — derived from reading actual source files, not training data.

---

*Architecture research for: Settings features in ai-manager Next.js 16 app*
*Researched: 2026-03-26*
