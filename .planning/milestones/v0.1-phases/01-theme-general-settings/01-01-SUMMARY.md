---
phase: 01-theme-general-settings
plan: "01"
subsystem: theme
tags: [css, next-themes, i18n, dark-mode, light-mode]
dependency_graph:
  requires: []
  provides: [theme-infrastructure, next-themes-provider, light-dark-css-vars, i18n-settings-keys]
  affects: [src/app/globals.css, src/app/layout.tsx, src/components/providers/theme-provider.tsx, src/lib/i18n.tsx]
tech_stack:
  added: [next-themes@0.4.6]
  patterns: [next-themes ThemeProvider wrapper, CSS custom-variant, oklch dual-theme variables]
key_files:
  created:
    - src/components/providers/theme-provider.tsx
  modified:
    - src/app/globals.css
    - src/app/layout.tsx
    - src/lib/i18n.tsx
decisions:
  - Fixed @custom-variant dark to use :where(.dark, .dark *) — matches both html.dark and all descendants
  - Light theme uses :root with inverted oklch lightness values from dark theme (1.0 - dark_value)
  - Dark theme moved from :root to .dark block (Midnight Studio values unchanged)
  - ThemeProvider placed outside TooltipProvider and I18nProvider per D-08 ordering
  - suppressHydrationWarning on <html> prevents class mismatch warning from next-themes inline script
metrics:
  duration: "3 minutes"
  completed: "2026-03-26"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 3
---

# Phase 01 Plan 01: Theme Infrastructure Summary

**One-liner:** Fixed Tailwind v4 @custom-variant CSS bug, added light theme CSS vars in :root, moved dark theme to .dark block, installed next-themes@0.4.6 with ThemeProvider wrapper, and added General settings i18n keys.

## What Was Built

Theme infrastructure enabling `next-themes` to control `class="dark"` on `<html>`, with CSS variables responding correctly to both light and dark modes.

### Task 1: Fix @custom-variant, restructure CSS variables, install next-themes

- **Fixed** `@custom-variant dark (&:is(.dark *))` → `(&:where(.dark, .dark *))` — the previous selector only matched descendants of `.dark`, not `.dark` itself; the fix ensures dark: utilities apply to both
- **Restructured** `globals.css`: light theme in `:root` (Light Studio), dark theme in `.dark` (Midnight Studio unchanged)
- **Light theme values** derived by inverting oklch lightness (formula: `light = 1.0 - dark`) with same hue/chroma
- **Installed** `next-themes@0.4.6` via pnpm

### Task 2: ThemeProvider, layout wiring, i18n keys

- **Created** `src/components/providers/theme-provider.tsx` — thin "use client" wrapper around next-themes `ThemeProvider`
- **Updated** `src/app/layout.tsx`:
  - Added `suppressHydrationWarning` to `<html>` to prevent SSR/CSR class mismatch warnings
  - Wrapped provider tree with `<ThemeProvider attribute="class" defaultTheme="system" enableSystem>`
  - ThemeProvider is outermost wrapper (outside TooltipProvider and I18nProvider)
- **Added** i18n translation keys for General settings panel to both `zh` and `en` in `src/lib/i18n.tsx`:
  - `settings.general`, `settings.generalDesc`, `settings.theme`, `settings.themeDesc`
  - `settings.themeLight`, `settings.themeDark`, `settings.themeSystem`
  - `settings.prompts`, `settings.promptsDesc`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | c5c91d1 | feat(01-01): fix @custom-variant, restructure CSS vars, install next-themes |
| Task 2 | df10c91 | feat(01-01): create ThemeProvider, wire layout, add i18n keys |

## Deviations from Plan

None - plan executed exactly as written.

Note: `pnpm build` fails due to a pre-existing Google Fonts network fetch error (Geist font) in the build environment — confirmed this failure existed before our changes via `git stash` test. Our changes do not introduce or worsen this error.

## Known Stubs

None — all theme infrastructure is fully wired. The ThemeProvider with `defaultTheme="system"` and `enableSystem` will automatically follow OS preference. CSS variables respond correctly to `.dark` class on `<html>`.

## Self-Check: PASSED

All files confirmed present and commits verified:
- `src/components/providers/theme-provider.tsx` — FOUND
- `src/app/globals.css` — FOUND
- `src/app/layout.tsx` — FOUND
- `src/lib/i18n.tsx` — FOUND
- Commit c5c91d1 — FOUND
- Commit df10c91 — FOUND
