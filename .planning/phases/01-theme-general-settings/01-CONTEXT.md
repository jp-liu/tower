# Phase 1: Theme + General Settings - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning
**Mode:** auto (all gray areas auto-resolved with recommended defaults)

<domain>
## Phase Boundary

Restructure the Settings page navigation and deliver a General settings panel with theme switching (dark/light/system) and language switching (zh/en). Includes fixing the Tailwind v4 `@custom-variant` CSS bug, installing `next-themes`, creating light theme CSS variables, and adding the ThemeProvider to the layout.

</domain>

<decisions>
## Implementation Decisions

### Light Theme Design
- **D-01:** Derive light theme by inverting the Midnight Studio oklch lightness values. Keep the same hue family (260 for neutrals, 75 for accent/primary gold). Create a `:root` light block and move current dark vars under `.dark`.
- **D-02:** The `@custom-variant dark` selector must be fixed from `(&:is(.dark *))` to `(&:where(.dark, .dark *))` BEFORE any theme work.

### Settings Navigation Restructure
- **D-03:** Replace existing 3-item nav (AI Tools / Skills / Plugins) with: General / AI Tools / Prompts. Skills and Plugins sections are removed (out of scope for v0.1).
- **D-04:** Default active section should be "General" (first item).

### Theme Toggle UX
- **D-05:** Use a segmented control (3 inline buttons) for dark/light/system selection. Standard pattern matching VS Code and macOS System Settings.

### Language Toggle UX
- **D-06:** Use a segmented control (2 inline buttons: 中文 / English) for language selection. Same visual pattern as theme toggle for consistency.

### Theme Infrastructure
- **D-07:** Use `next-themes ^0.4.6` with `attribute="class"` (matches existing `@custom-variant dark` pattern). Wrap in layout.tsx with `suppressHydrationWarning` on `<html>`.
- **D-08:** ThemeProvider must be a client component wrapping the existing provider tree. Place it OUTSIDE I18nProvider (theme is visual, not content).

### Claude's Discretion
- Light theme exact oklch values — Claude can derive these by inverting lightness while keeping hue/chroma consistent
- General settings panel layout details (spacing, grouping) — follow existing settings page patterns
- i18n translation keys for new settings labels — follow existing naming convention

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Theme Infrastructure
- `src/app/globals.css` — Current CSS variables (Midnight Studio dark theme only), `@custom-variant dark` bug on line 5
- `src/app/layout.tsx` — Root layout with provider tree, needs ThemeProvider + suppressHydrationWarning
- `node_modules/next/dist/docs/` — Next.js 16 docs (check for any theme/layout breaking changes)

### Settings Page
- `src/app/settings/page.tsx` — Current settings page (client component, AI Tools only)
- `src/components/settings/settings-nav.tsx` — Navigation component with NAV_ITEMS array
- `src/components/settings/ai-tools-config.tsx` — Existing AI Tools panel (keep functional)

### i18n System
- `src/lib/i18n.tsx` — I18nProvider with localStorage persistence, translation keys, useI18n hook

### Research
- `.planning/research/SUMMARY.md` — Key findings including next-themes setup and CSS fix
- `.planning/research/PITFALLS.md` — FOUC prevention, Tailwind v4 gotchas

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `I18nProvider` + `useI18n()`: Fully functional i18n with localStorage persistence — just needs a UI control in General settings
- `SettingsNav`: Left nav component with clean pattern (array of items with id/label/description/icon) — modify NAV_ITEMS array
- `AIToolsConfig`: Existing functional component — keep as-is, just re-slot under new nav structure
- shadcn/ui components: Button, Tooltip already available for segmented controls

### Established Patterns
- Client-side state: localStorage for persistence (locale already uses this, theme should match)
- Provider tree in layout.tsx: TooltipProvider > I18nProvider > LayoutClient — add ThemeProvider here
- Settings page: Client component with activeSection state + conditional rendering

### Integration Points
- `layout.tsx`: Add ThemeProvider wrapper, add `suppressHydrationWarning` to `<html>`
- `globals.css`: Fix @custom-variant, restructure CSS vars into light (default) and .dark blocks
- `settings-nav.tsx`: Update NAV_ITEMS array (General, AI Tools, Prompts)
- `settings/page.tsx`: Add General settings section, update activeSection default

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for theme toggle and language toggle UI.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope (auto mode).

</deferred>

---

*Phase: 01-theme-general-settings*
*Context gathered: 2026-03-26*
