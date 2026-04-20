# Phase 1: Theme + General Settings - Research

**Researched:** 2026-03-26
**Domain:** Next.js 16 App Router theme switching (next-themes), Tailwind v4 CSS variables, Settings page restructure, i18n UI
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Derive light theme by inverting the Midnight Studio oklch lightness values. Keep the same hue family (260 for neutrals, 75 for accent/primary gold). Create a `:root` light block and move current dark vars under `.dark`.
- **D-02:** The `@custom-variant dark` selector must be fixed from `(&:is(.dark *))` to `(&:where(.dark, .dark *))` BEFORE any theme work.
- **D-03:** Replace existing 3-item nav (AI Tools / Skills / Plugins) with: General / AI Tools / Prompts. Skills and Plugins sections are removed (out of scope for v0.1).
- **D-04:** Default active section should be "General" (first item).
- **D-05:** Use a segmented control (3 inline buttons) for dark/light/system selection. Standard pattern matching VS Code and macOS System Settings.
- **D-06:** Use a segmented control (2 inline buttons: 中文 / English) for language selection. Same visual pattern as theme toggle for consistency.
- **D-07:** Use `next-themes ^0.4.6` with `attribute="class"` (matches existing `@custom-variant dark` pattern). Wrap in layout.tsx with `suppressHydrationWarning` on `<html>`.
- **D-08:** ThemeProvider must be a client component wrapping the existing provider tree. Place it OUTSIDE I18nProvider (theme is visual, not content).

### Claude's Discretion

- Light theme exact oklch values — Claude can derive these by inverting lightness while keeping hue/chroma consistent
- General settings panel layout details (spacing, grouping) — follow existing settings page patterns
- i18n translation keys for new settings labels — follow existing naming convention

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope (auto mode).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GNRL-01 | User can switch between dark, light, and system theme modes | next-themes `useTheme()` hook; segmented control UI (D-05) |
| GNRL-02 | User's theme preference persists across browser sessions | next-themes persists to `localStorage` automatically; no extra code needed |
| GNRL-03 | System theme mode automatically follows OS dark/light preference | next-themes handles `prefers-color-scheme` media query natively when `theme="system"` |
| GNRL-04 | User can switch UI language between Chinese and English | Existing `I18nProvider.setLocale()` just needs a segmented control UI (D-06); no new backend work |
| GNRL-05 | Settings page has restructured left navigation with General, AI Tools, and Prompts sections | Modify `NAV_ITEMS` in `settings-nav.tsx`; change default `activeSection` to "general" (D-03, D-04) |
</phase_requirements>

---

## Summary

Phase 1 is a focused infrastructure + UI phase. The project already has a working Tailwind v4 dark theme (Midnight Studio), a functional i18n system (`I18nProvider` + `useI18n`), and a settings page with a left nav. The work is: (1) fix a CSS selector bug, (2) install `next-themes` and wire it into the layout, (3) create light theme CSS variables, (4) restructure the settings nav, and (5) build a General settings panel with theme and language controls.

The single most important prerequisite is fixing `@custom-variant dark (&:is(.dark *))` to `(&:where(.dark, .dark *))` in `globals.css`. Without this fix, `next-themes` sets `class="dark"` on `<html>` but no `dark:` Tailwind utilities activate because `(&:is(.dark *))` only matches descendants of `.dark` — not the element carrying `.dark` itself.

The second critical concern is FOUC (Flash of Unstyled Content). Using `next-themes` instead of a manual `useEffect + localStorage` approach is mandatory — it injects an inline script in `<head>` that applies the class synchronously before any paint. `suppressHydrationWarning` on `<html>` is also required because `next-themes` modifies the `class` attribute after SSR, which otherwise causes React hydration warnings.

**Primary recommendation:** Fix the CSS bug first, install `next-themes`, create light theme CSS variables by inverting Midnight Studio lightness, wire `ThemeProvider` into `layout.tsx` (outside `I18nProvider`), then build the General settings panel. All of this is one cohesive phase.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next-themes | ^0.4.6 (latest) | SSR-safe dark/light/system theme switching | Only library that prevents FOUC in Next.js App Router via inline head script; handles localStorage, prefers-color-scheme, and html class atomically |
| React Context (existing) | — | Theme consumption via `useTheme()` hook | next-themes ships its own context + hook; no custom context needed |
| I18nProvider (existing) | — | Language switching | Already complete; only needs a UI control wired to `setLocale()` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn/ui Button | already installed | Segmented control buttons for theme/language toggles | Already in codebase; use for theme and language segmented controls |
| Lucide React | already installed | Icons for settings nav (General, AI Tools, Prompts) | Already used in existing `settings-nav.tsx` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| next-themes | Manual useEffect + localStorage | Manual approach causes FOUC on every hard reload; SSR has no access to localStorage so first render always shows default; next-themes is the only reliable solution |
| next-themes | Zustand persist middleware | Zustand persist causes known SSR hydration mismatch in Next.js App Router (pmndrs/zustand #1382); not safe for SSR-rendered preferences |

**Installation:**
```bash
npm install next-themes
```

**Version verification:** `next-themes` latest is `0.4.6` (verified against npm registry on 2026-03-26). This is also the latest — `^0.4.6` pins to exactly 0.4.6 (no newer patch yet).

---

## Architecture Patterns

### Recommended File Changes

```
src/
├── app/
│   ├── globals.css              # MODIFY: fix @custom-variant line 5, add :root light vars, move dark vars to .dark
│   └── layout.tsx               # MODIFY: add ThemeProvider wrapper, suppressHydrationWarning on <html>
├── components/
│   ├── providers/
│   │   └── theme-provider.tsx   # NEW: "use client" wrapper around next-themes ThemeProvider
│   └── settings/
│       ├── settings-nav.tsx     # MODIFY: replace NAV_ITEMS (General/AI Tools/Prompts), default to "general"
│       ├── general-config.tsx   # NEW: theme segmented control + language segmented control
│       └── ai-tools-config.tsx  # NO CHANGE (keep functional, just re-slot under new nav)
├── app/settings/
│   └── page.tsx                 # MODIFY: add "general" section, change activeSection default to "general"
└── lib/
    └── i18n.tsx                 # MODIFY: add translation keys for new General settings UI strings
```

### Pattern 1: next-themes ThemeProvider Wrapper (Client Component)

**What:** Create a thin `"use client"` wrapper component that renders the `next-themes` ThemeProvider. This is required because `layout.tsx` is a Server Component and cannot directly import a third-party client-side provider.

**When to use:** Any time a third-party library that needs `"use client"` must be used in the root layout.

**Example:**
```typescript
// Source: Next.js 16 docs — node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md
// src/components/providers/theme-provider.tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

### Pattern 2: ThemeProvider Placement in layout.tsx

**What:** ThemeProvider wraps the entire body tree. OUTSIDE `I18nProvider` per D-08. `suppressHydrationWarning` on `<html>` prevents React hydration warnings when next-themes modifies the class attribute after SSR.

**When to use:** Root layout wiring.

**Example:**
```typescript
// src/app/layout.tsx (modified body section)
<html lang="zh-CN" suppressHydrationWarning>
  <body className={...}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <I18nProvider>
          <LayoutClient workspaces={workspaces}>
            {children}
          </LayoutClient>
        </I18nProvider>
      </TooltipProvider>
    </ThemeProvider>
  </body>
</html>
```

### Pattern 3: Theme Toggle with mounted Guard

**What:** Theme UI components must wait until the component is mounted before rendering theme-dependent UI, to avoid SSR/client mismatch.

**When to use:** Any component that renders based on the current theme value from `useTheme()`.

**Example:**
```typescript
// Source: next-themes README — mounted guard pattern
"use client";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return null; // Prevents hydration mismatch

  return (
    <div className="flex gap-1 rounded-md border p-1">
      {(["light", "dark", "system"] as const).map((t) => (
        <button
          key={t}
          onClick={() => setTheme(t)}
          className={theme === t ? "bg-primary text-primary-foreground rounded px-3 py-1" : "rounded px-3 py-1 text-muted-foreground"}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
```

### Pattern 4: CSS Variable Restructure (globals.css)

**What:** Move current dark vars under `.dark`, add `:root` with light variants (inverted lightness). Fix `@custom-variant` on line 5.

**When to use:** The single CSS file change that enables the entire theme system.

**Example:**
```css
/* globals.css — line 5 fix (MUST be first change) */
@custom-variant dark (&:where(.dark, .dark *));

/* Light theme — :root default */
:root {
  --background: oklch(0.97 0.005 260);   /* was 0.15 → inverted to ~0.97 */
  --foreground: oklch(0.15 0.005 260);   /* was 0.95 → inverted to ~0.15 */
  --card: oklch(0.94 0.005 260);         /* was 0.19 → inverted to ~0.94 */
  --card-foreground: oklch(0.15 0.005 260);
  --popover: oklch(0.94 0.006 260);
  --popover-foreground: oklch(0.15 0.005 260);
  --primary: oklch(0.65 0.14 75);        /* slightly darker gold for light bg */
  --primary-foreground: oklch(0.97 0.005 260);
  --secondary: oklch(0.91 0.006 260);
  --secondary-foreground: oklch(0.25 0.005 260);
  --muted: oklch(0.91 0.005 260);
  --muted-foreground: oklch(0.50 0.008 260);
  --accent: oklch(0.89 0.008 260);
  --accent-foreground: oklch(0.15 0.005 260);
  --destructive: oklch(0.55 0.2 25);
  --border: oklch(0.82 0.008 260);
  --input: oklch(0.89 0.006 260);
  --ring: oklch(0.65 0.14 75);
  /* chart and sidebar vars follow same inversion pattern */
  --radius: 0.5rem;
  --sidebar: oklch(0.95 0.006 260);
  --sidebar-foreground: oklch(0.20 0.005 260);
  --sidebar-primary: oklch(0.65 0.14 75);
  --sidebar-primary-foreground: oklch(0.97 0.005 260);
  --sidebar-accent: oklch(0.91 0.008 260);
  --sidebar-accent-foreground: oklch(0.15 0.005 260);
  --sidebar-border: oklch(0.85 0.008 260);
  --sidebar-ring: oklch(0.65 0.14 75);
}

/* Dark theme — Midnight Studio (existing vars, moved here) */
.dark {
  --background: oklch(0.15 0.005 260);
  /* ... all existing :root vars move here unchanged ... */
}
```

**Claude's discretion note:** The exact light theme lightness values are at Claude's discretion (locked by D-01). The formula is: light_value ≈ 1.0 - dark_value, rounded to 2 decimal places, while keeping hue (260, 75, 25) and chroma unchanged.

### Pattern 5: Segmented Control Component

**What:** A row of buttons that look like a connected segment. Active button has filled background; inactive buttons are ghost.

**When to use:** Theme toggle (3 options) and language toggle (2 options). Same component instance, parameterized.

**Example:**
```typescript
// No external library needed — built from shadcn Button primitives
interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="inline-flex rounded-md border bg-muted p-1 gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded px-3 py-1 text-sm transition-colors ${
            value === opt.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
```

### Anti-Patterns to Avoid

- **Manual useEffect + localStorage for theme:** Causes FOUC. Use `next-themes` only.
- **Zustand persist for theme state:** Known SSR hydration mismatch. Theme state must live in `next-themes`, not Zustand.
- **Rendering theme-dependent UI without mounted guard:** Causes hydration mismatch errors.
- **Using `attribute="data-theme"` in ThemeProvider:** Does not match existing `@custom-variant dark (&:where(.dark, .dark *))` selector. Must use `attribute="class"`.
- **Skipping `suppressHydrationWarning` on `<html>`:** Produces React hydration warnings every page load since next-themes modifies the class attribute post-SSR.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FOUC prevention for theme | Custom inline script in layout | `next-themes` | next-themes injects an optimized inline script that reads localStorage before any paint; custom solutions miss edge cases (system preference, no-JS fallback) |
| System theme detection | `window.matchMedia('prefers-color-scheme: dark')` listener | `next-themes` with `enableSystem` | next-themes manages the media query listener, removes it on unmount, handles system preference changes correctly, and syncs with the stored preference |
| Theme persistence | `localStorage.setItem("theme", ...)` in useEffect | `next-themes` | next-themes handles the SSR/CSR split — reading localStorage on client only, while server renders with default theme, without causing hydration errors |
| Language toggle UI | New custom component | Segmented control pattern using existing shadcn Button | The existing `setLocale()` already handles persistence; only a UI wrapper is needed |

**Key insight:** `next-themes` solves three problems simultaneously — FOUC prevention, system preference, and SSR safety. Any custom solution that addresses only one of these creates technical debt.

---

## Common Pitfalls

### Pitfall 1: @custom-variant Selector Does Not Match html.dark

**What goes wrong:** After installing `next-themes`, theme switching appears to work (localStorage updates, class is set on `<html>`) but dark styles never activate.

**Why it happens:** The existing selector `@custom-variant dark (&:is(.dark *))` matches elements that are *descendants* of `.dark`. The `<html>` element carrying `class="dark"` is not a descendant of itself — it IS `.dark`. So no elements ever match.

**How to avoid:** Change line 5 in `globals.css` FIRST, before any other work:
```css
/* WRONG (current) */
@custom-variant dark (&:is(.dark *));

/* CORRECT */
@custom-variant dark (&:where(.dark, .dark *));
```

**Warning signs:** DevTools shows `class="dark"` on `<html>` but background remains light; `dark:bg-white` test class has no effect.

---

### Pitfall 2: FOUC (Flash of Unstyled Content)

**What goes wrong:** Hard refresh in light mode briefly shows dark background before switching to light. Or vice versa.

**Why it happens:** Server renders with `:root` defaults (light theme after restructure). Client reads localStorage after hydration — too late to prevent the flash.

**How to avoid:** Use `next-themes` — it injects an inline `<script>` in `<head>` that runs synchronously before any paint. This is the only reliable FOUC prevention strategy in Next.js App Router. Also add `suppressHydrationWarning` to `<html>`.

**Warning signs:** Visible color flash on hard reload (Ctrl+Shift+R) after setting light theme preference.

---

### Pitfall 3: Theme Toggle Shows Wrong Value Before Mount

**What goes wrong:** Theme toggle renders "dark" when user has "light" set. Or shows "system" text when it should show the resolved theme.

**Why it happens:** `useTheme()` returns `undefined` for `theme` until the component mounts (because localStorage is not available during SSR). Rendering without the `mounted` guard shows the SSR default.

**How to avoid:** Add `mounted` guard in any component that reads `theme` from `useTheme()`:
```typescript
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return <div className="w-[180px] h-[36px]" />; // placeholder preserving layout
```

**Warning signs:** Toggle displays wrong active option on first render; React hydration mismatch warning in console.

---

### Pitfall 4: ThemeProvider Placed Inside I18nProvider (Wrong Nesting Order)

**What goes wrong:** Theme changes may conflict with i18n re-renders. Conceptually wrong — theme is visual infrastructure, not content.

**Why it happens:** Developers nest providers in whatever order seems convenient.

**How to avoid:** Per D-08, ThemeProvider is OUTSIDE I18nProvider. Correct nesting order in `layout.tsx`:
```
ThemeProvider
  └── TooltipProvider
        └── I18nProvider
              └── LayoutClient
```

---

### Pitfall 5: Light Theme Shows as Unstyled White (Missing CSS Variables)

**What goes wrong:** User selects "Light" and the UI loses all its custom colors — shows browser default white/black with no design system.

**Why it happens:** The current codebase has only one CSS theme (Midnight Studio dark) in `:root`. If `:root` stays dark and `.dark` is added without creating light vars, the light theme has no variables defined.

**How to avoid:** The CSS restructure in D-01 is mandatory before the toggle is wired up. Move existing dark vars to `.dark`, create light vars in `:root`. This is a prerequisite task, not optional.

---

### Pitfall 6: Settings Nav defaulting to "ai-tools" After Rename

**What goes wrong:** Page loads showing AI Tools section even though General should be default (D-04). `activeSection` default in `settings/page.tsx` is still `"ai-tools"`.

**Why it happens:** The initial `useState("ai-tools")` was correct before the refactor. After adding General as the first nav item, the default must change.

**How to avoid:** In `settings/page.tsx`, change `useState("ai-tools")` to `useState("general")`.

---

## Code Examples

### next-themes ThemeProvider Setup
```typescript
// Source: next-themes README (https://github.com/pacocoursey/next-themes)
// src/components/providers/theme-provider.tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

### layout.tsx Integration
```typescript
// src/app/layout.tsx — body section with ThemeProvider
import { ThemeProvider } from "@/components/providers/theme-provider";

// In RootLayout JSX:
<html lang="zh-CN" suppressHydrationWarning>
  <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <I18nProvider>
          <LayoutClient workspaces={workspaces}>
            {children}
          </LayoutClient>
        </I18nProvider>
      </TooltipProvider>
    </ThemeProvider>
  </body>
</html>
```

### i18n Translation Keys to Add
```typescript
// New keys needed in both zh and en maps in src/lib/i18n.tsx
// (follow existing "settings." namespace pattern)
"settings.general": "通用" / "General"
"settings.generalDesc": "主题与语言偏好" / "Appearance and language preferences"
"settings.theme": "主题" / "Theme"
"settings.themeDesc": "选择界面主题" / "Choose interface theme"
"settings.themeLight": "浅色" / "Light"
"settings.themeDark": "深色" / "Dark"
"settings.themeSystem": "跟随系统" / "System"
"settings.prompts": "提示词" / "Prompts"
"settings.promptsDesc": "管理 AI 提示词模板" / "Manage AI prompt templates"
```

### Settings Nav Updated NAV_ITEMS
```typescript
// src/components/settings/settings-nav.tsx
import { Settings, Cpu, FileText } from "lucide-react";

const NAV_ITEMS = [
  {
    id: "general",
    label: t("settings.general"),  // or hardcoded "General" if nav doesn't use i18n
    description: t("settings.generalDesc"),
    icon: Settings,
  },
  {
    id: "ai-tools",
    label: "AI Tools",
    description: "AI 工具配置与默认模型",
    icon: Cpu,
  },
  {
    id: "prompts",
    label: "Prompts",
    description: "管理 AI 提示词模板",
    icon: FileText,
  },
];
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `darkMode: "class"` in tailwind.config.js | `@custom-variant dark (...)` in CSS | Tailwind v4 (2024) | No more tailwind.config.js; dark mode is a CSS concern |
| `useEffect + localStorage` for theme | `next-themes` with inline head script | Next.js App Router adoption (~2023) | Eliminates FOUC at the framework level; not achievable manually |
| `tailwind.config.js` theme config | `@theme inline { ... }` in CSS | Tailwind v4 (2024) | CSS variables defined in CSS, not JS config |

**Deprecated/outdated:**
- `darkMode: "class"` in tailwind.config.js: replaced by `@custom-variant` in Tailwind v4
- Manual localStorage theme detection with `useEffect`: causes FOUC; superseded by `next-themes`

---

## Environment Availability

Step 2.6: This phase has no external service dependencies. It requires only `npm install next-themes` (package registry access) and editing existing source files.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| next-themes | Theme switching | Not yet installed | 0.4.6 available on npm | None — required |
| Node.js / npm | Package install | Available | (project already running) | — |

**Missing dependencies with no fallback:**
- `next-themes` must be installed via `npm install next-themes` as Wave 0 task

---

## Validation Architecture

> `workflow.nyquist_validation` is not set to false in config.json — validation section is included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected (no jest.config, vitest.config, or test/ directory) |
| Config file | None — see Wave 0 gaps |
| Quick run command | N/A until framework installed |
| Full suite command | N/A until framework installed |

**Note:** This project has no test infrastructure. For Phase 1 (CSS + UI changes), the most practical validation is browser smoke testing. The verification checklist below covers the observable behaviors.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GNRL-01 | Theme toggle renders 3 options (Light/Dark/System) and switches theme | manual smoke | — | N/A |
| GNRL-02 | After reload, theme preference is restored from localStorage | manual smoke | — | N/A |
| GNRL-03 | System mode follows OS preference (DevTools: Emulate prefers-color-scheme) | manual smoke | — | N/A |
| GNRL-04 | Language toggle switches UI between zh and en | manual smoke | — | N/A |
| GNRL-05 | Settings nav shows General / AI Tools / Prompts; defaults to General | manual smoke | — | N/A |

### Sampling Rate

- **Per task commit:** Visual smoke test in browser (no automated command until test infra exists)
- **Per wave merge:** Run all 5 manual checks above
- **Phase gate:** All 5 checks pass before `/gsd:verify-work`

### Wave 0 Gaps

- No test framework installed. Phase 1 is UI-only with no business logic to unit test. Manual browser verification is the appropriate validation strategy for this phase.
- If automated checks are desired: `npm install -D vitest @vitejs/plugin-react` could cover basic component rendering tests, but this is out of scope for Phase 1 per deferred ideas.

---

## Open Questions

1. **Settings nav i18n: should nav labels use `t()` or hardcoded strings?**
   - What we know: existing `settings-nav.tsx` uses hardcoded English strings for nav labels (e.g., "AI Tools")
   - What's unclear: should the new "General" and "Prompts" labels be translated via `useI18n()`? The nav component is client-side and can call `useI18n()`.
   - Recommendation: Follow the existing pattern (hardcoded) for nav item labels to keep `settings-nav.tsx` stateless — translations are Claude's discretion per CONTEXT.md. The panel content inside General settings panel should use `t()` for all user-visible strings.

2. **Light theme visual regression on existing Kanban dark styles**
   - What we know: Changing `@custom-variant dark (&:is(.dark *))` to `(&:where(.dark, .dark *))` affects all existing `dark:` utilities in the entire codebase
   - What's unclear: whether any existing component accidentally relied on the broken behavior (e.g., elements were styled assuming dark: would NOT fire on the html element)
   - Recommendation: After applying the CSS fix, manually verify the Kanban board in dark mode renders correctly before proceeding. The change should be strictly additive (now matches `<html>` itself in addition to its children) so no regression is expected.

---

## Sources

### Primary (HIGH confidence)

- Codebase analysis: `src/app/globals.css` (current CSS vars, @custom-variant bug), `src/app/layout.tsx` (current provider tree), `src/lib/i18n.tsx` (i18n system), `src/app/settings/page.tsx` (current settings page), `src/components/settings/settings-nav.tsx` (nav component), `.planning/phases/01-theme-general-settings/01-CONTEXT.md` (locked decisions)
- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` — ThemeProvider wrapper pattern, "render providers as deep as possible" guidance
- `.planning/research/SUMMARY.md` — prior research on next-themes setup and CSS fix
- `.planning/research/PITFALLS.md` — FOUC prevention, Tailwind v4 gotchas, hydration mismatch patterns
- npm registry: `npm view next-themes version` → `0.4.6` (verified 2026-03-26)

### Secondary (MEDIUM confidence)

- [Dark Mode Next.js 15 + Tailwind v4 guide](https://www.sujalvanjare.com/blog/dark-mode-nextjs15-tailwind-v4) — confirms `@custom-variant dark (&:where(.dark, .dark *))`, `suppressHydrationWarning`, `next-themes@0.4.6` (cited in prior research)
- [Solving class-based dark mode Tailwind 4](https://iifx.dev/en/articles/456423217/solved-enabling-class-based-dark-mode-with-next-15-next-themes-and-tailwind-4) — confirms @custom-variant fix (cited in prior research)

### Tertiary (LOW confidence)

- None — all critical findings are verified from codebase or primary sources

---

## Project Constraints (from CLAUDE.md)

**From AGENTS.md (loaded via CLAUDE.md `@AGENTS.md`):**

- This project runs Next.js 16 — check `node_modules/next/dist/docs/` before writing any code, heed deprecation notices
- Cascade deletes: Deleting Workspace cascades to Projects and Tasks
- Task `order` field controls Kanban position — preserve on create
- Project `type` is derived from `gitUrl` — do not set independently
- Label replacement via `setTaskLabels` is a full replace, not merge

**From global TypeScript rules:**

- No `console.log` in production code
- Use spread operator for immutable updates (no in-place mutation)
- Functions < 50 lines, files < 800 lines
- All user inputs validated (Zod where appropriate)
- No hardcoded secrets

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `next-themes` version verified against npm registry; all code examples derived from actual codebase files and official Next.js 16 docs
- Architecture: HIGH — all integration points verified by reading actual source files (`layout.tsx`, `globals.css`, `settings-nav.tsx`, `i18n.tsx`)
- CSS variable values: MEDIUM — light theme oklch values are Claude's discretion (D-01); the inversion formula is well-understood but exact values need visual validation
- Pitfalls: HIGH — `@custom-variant` bug confirmed by reading actual `globals.css` line 5; FOUC prevention and mounted guard confirmed by prior research and official docs

**Research date:** 2026-03-26
**Valid until:** 2026-04-25 (30 days; stable library ecosystem)
