# Stack Research

**Domain:** Settings features for existing Next.js 16 AI task manager
**Researched:** 2026-03-26
**Confidence:** HIGH

## Context: What Already Exists

This is a subsequent milestone on an established stack. The following are confirmed working and must NOT be replaced:

| Already in Place | Version | Notes |
|-----------------|---------|-------|
| Next.js App Router | 16.2.1 | Server Components + Server Actions |
| React | 19.2.4 | |
| Tailwind v4 | ^4 | `@tailwindcss/postcss`, no `tailwind.config.js` |
| Zustand | ^5.0.12 | Client state management |
| `@custom-variant dark (&:is(.dark *))` | — | Already in `globals.css` line 5 |
| i18n via React Context + localStorage | — | `src/lib/i18n.tsx`, zh/en, `setLocale` persists to localStorage |
| `AgentConfig` model | Prisma 6 | DB model exists |
| `AgentPrompt` model | Prisma 6 | DB model + Server Actions in `src/actions/prompt-actions.ts` |
| `testEnvironment()` adapter interface | — | `AdapterModule` in `src/lib/adapters/types.ts`; API at `POST /api/adapters/test` |

---

## New Additions Required

### 1. Theme Switching (Dark / Light / System)

**Add: `next-themes` ^0.4.6**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `next-themes` | ^0.4.6 | Manages `dark` class on `<html>`, persists to localStorage, respects system preference | Zero-flicker SSR-safe solution; de facto standard for Next.js App Router dark mode; integrates directly with the `.dark` CSS custom variant already in `globals.css` |

**Integration details:**

The project already has `@custom-variant dark (&:is(.dark *))` in `globals.css`. This variant fires when an ancestor carries `.dark`. However, `next-themes` sets the class on `<html>` itself, and the selector `&:is(.dark *)` matches descendants of `.dark`. The element at root `<html>` does NOT match its own class this way.

The correct Tailwind v4 variant for next-themes is:

```css
/* Replace line 5 in globals.css */
@custom-variant dark (&:where(.dark, .dark *));
```

This matches both `.dark` itself AND `.dark *` descendants — which is what `next-themes` needs when it sets `class="dark"` on `<html>`.

**`ThemeProvider` wrapper** (new `src/components/providers/theme-provider.tsx`):

```tsx
"use client";
import { ThemeProvider as NextThemesProvider } from "next-themes";
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
```

**Root layout change:** Add `suppressHydrationWarning` to `<html>` and wrap with `ThemeProvider`. No server-side theme detection needed — localStorage fallback handled by next-themes.

**Theme toggle hook:** `useTheme()` from `next-themes` provides `theme`, `setTheme`, `systemTheme`. Use in Settings UI, no additional state management needed.

---

### 2. Enhanced i18n Persistence

**No new library required.** The existing system already persists locale to `localStorage` via `setLocale` in `src/lib/i18n.tsx` and reads it back on initialization. The i18n implementation is complete for persistence.

What IS needed for the Settings milestone:
- Add translation keys for new Settings UI strings (theme switcher labels, prompt management labels)
- The i18n.tsx file is a flat key-value map — just extend both `zh` and `en` objects

No library additions required here. The custom React Context approach is appropriate for this app's scale.

---

### 3. CLI Environment Testing UI

**No new library required.** The adapter test API already exists at `POST /api/adapters/test`. The UI needs to:
- Call this endpoint from a client component
- Render `TestResult.checks[]` — each check has `name`, `passed`, `message`
- Show loading / error states

The existing Zustand store pattern and `fetch` are sufficient. No new dependencies.

---

### 4. Agent Prompt Management (CRUD UI)

**No new library required.** All Server Actions exist in `src/actions/prompt-actions.ts`:
- `getPrompts`, `createPrompt`, `updatePrompt`, `deletePrompt`
- `AgentPrompt` Prisma model is in the schema

What IS needed:
- New React components in `src/components/settings/` for prompt list, create/edit form, delete confirmation
- A new `general` section in `SettingsNav` (the nav currently has `ai-tools`, `skills`, `plugins`)
- The settings page needs a `general` section wired to theme + language controls

For the "select prompt when creating task" requirement — the existing `createTask` action supports `labelIds` but NOT `promptId`. A Prisma schema migration will be required to add `promptId` to the `Task` model.

**Schema addition needed:**

```prisma
model Task {
  // ... existing fields
  promptId    String?
  prompt      AgentPrompt? @relation(fields: [promptId], references: [id], onDelete: SetNull)
}

model AgentPrompt {
  // ... existing fields
  tasks  Task[]
}
```

This requires `prisma db push` — compatible with the existing no-migration-file strategy.

---

## Recommended Stack Additions Summary

| Library | Version | Install As | Purpose |
|---------|---------|-----------|---------|
| `next-themes` | `^0.4.6` | dependency | Theme switching with SSR-safe localStorage persistence |

That is the only new dependency. Everything else is covered by existing stack.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `react-i18next` / `next-intl` | Overkill — the existing flat-key React Context i18n is perfectly adequate for a bilingual single-user local app; migration cost outweighs benefit | Extend existing `src/lib/i18n.tsx` |
| `react-query` / `swr` for adapter test | Single fire-and-forget fetch; no caching needed | Native `fetch` + `useState` |
| CSS-in-JS for theming | Tailwind v4 CSS variables already cover the design token system; adding another theming layer creates conflicts | `next-themes` + existing CSS variables |
| `color-mode` (Chakra UI) | Not using Chakra; incompatible with current UI stack | `next-themes` |
| Manual `cookie`-based theme detection | next-themes handles this automatically; manual cookies add SSR complexity for no gain | `next-themes` with `suppressHydrationWarning` |

---

## Integration Points and Gotchas

### Theme Switching Integration

**Gotcha — existing CSS custom variant is incorrect for next-themes.**

The current `globals.css` has:
```css
@custom-variant dark (&:is(.dark *));
```

This selector means: apply when the element IS a descendant of `.dark`. The `<html>` element with `class="dark"` does NOT match `&:is(.dark *)` because it is `.dark` itself, not a child of `.dark`. The fix is:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Without this fix, theme switching will appear to do nothing — the dark class will be set on `<html>` but no `dark:` Tailwind utilities will activate.

**The existing app has only ONE CSS theme defined (Midnight Studio — a dark theme).** Adding a genuine light theme requires defining a separate set of CSS variables under `.light` or `html:not(.dark)`. Without a light theme design, the toggle will switch to a broken/unstyled light state. The roadmap should include a light theme CSS variable block.

### Layout Integration for ThemeProvider

`ThemeProvider` must wrap at or above `I18nProvider` in `layout.tsx`. Since `layout.tsx` is a Server Component and `ThemeProvider` requires `"use client"`, a wrapper component pattern is already in use (`LayoutClient`) — `ThemeProvider` fits the same pattern.

### Settings Page Restructure

The current `settings/page.tsx` has hardcoded `activeSection = "ai-tools"`. The milestone adds a `general` section (theme + language). The nav items in `settings-nav.tsx` need a new "General" entry, and the page needs to handle `general` as a section.

### Prompt Selection in Task Create

The `createTask` action signature (`src/actions/task-actions.ts`) currently does not accept `promptId`. The Server Action must be extended alongside the Prisma schema change. Existing `create_task` MCP tool also needs updating if prompt selection should be available via MCP.

---

## Installation

```bash
pnpm add next-themes
```

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|----------------|-------|
| `next-themes@^0.4.6` | Next.js 16 App Router, React 19, Tailwind v4 | Requires `suppressHydrationWarning` on `<html>`; tested pattern as of 2026 |
| `next-themes@^0.4.6` | `@custom-variant dark (&:where(.dark, .dark *))` | Requires variant update from existing `(&:is(.dark *))` |

---

## Sources

- [next-themes GitHub](https://github.com/pacocoursey/next-themes) — confirmed App Router support, `attribute="class"` pattern
- [Dark Mode Next.js 15 + Tailwind v4 guide](https://www.sujalvanjare.com/blog/dark-mode-nextjs15-tailwind-v4) — confirms `@custom-variant dark (&:where(.dark, .dark *))` directive, `suppressHydrationWarning` requirement, `next-themes@0.4.6` version
- [Solving class-based dark mode with Tailwind 4](https://iifx.dev/en/articles/456423217/solved-enabling-class-based-dark-mode-with-next-15-next-themes-and-tailwind-4) — confirms `@custom-variant` fix for Tailwind v4 + next-themes
- Codebase inspection of `src/app/globals.css`, `src/lib/i18n.tsx`, `src/actions/prompt-actions.ts`, `src/lib/adapters/types.ts`, `prisma/schema.prisma` — HIGH confidence

---

*Stack research for: ai-manager Settings milestone (theme switching, i18n persistence, CLI adapter testing UI, agent prompt CRUD)*
*Researched: 2026-03-26*
