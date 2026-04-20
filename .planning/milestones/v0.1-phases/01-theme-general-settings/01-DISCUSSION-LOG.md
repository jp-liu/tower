# Phase 1: Theme + General Settings - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-26
**Phase:** 01-theme-general-settings
**Areas discussed:** Light theme design, Settings nav restructure, Theme toggle UX, Language toggle UX
**Mode:** auto (all areas auto-resolved with recommended defaults)

---

## Light Theme Design

| Option | Description | Selected |
|--------|-------------|----------|
| Invert Midnight Studio | Derive light theme by inverting oklch lightness values, keep hue 260 + gold accent | ✓ |
| Design from scratch | Create an independent light theme color palette | |
| Use shadcn default | Adopt shadcn's default light/dark theme variables | |

**User's choice:** [auto] Invert Midnight Studio (recommended default)
**Notes:** Simplest approach, maintains visual cohesion with existing dark theme. Gold accent (hue 75) works in both modes.

---

## Settings Navigation Restructure

| Option | Description | Selected |
|--------|-------------|----------|
| Replace with General/AI Tools/Prompts | Remove Skills and Plugins placeholders, add General and Prompts | ✓ |
| Add General, keep all existing | Keep AI Tools/Skills/Plugins, add General as first item | |
| Full restructure with categories | Group settings into categories with sub-items | |

**User's choice:** [auto] Replace with General/AI Tools/Prompts (recommended default)
**Notes:** Skills and Plugins have no implementation and are explicitly out of scope for v0.1.

---

## Theme Toggle UX

| Option | Description | Selected |
|--------|-------------|----------|
| Segmented control (3 buttons) | Inline dark/light/system buttons, standard pattern | ✓ |
| Dropdown select | Select menu with 3 options | |
| Radio buttons | Vertical radio group | |

**User's choice:** [auto] Segmented control (recommended default)
**Notes:** Standard pattern used by VS Code, macOS System Settings, GitHub.

---

## Language Toggle UX

| Option | Description | Selected |
|--------|-------------|----------|
| Segmented control (2 buttons) | Inline 中文/English buttons, matches theme toggle pattern | ✓ |
| Dropdown select | Select menu with locale options | |

**User's choice:** [auto] Segmented control (recommended default)
**Notes:** Only 2 options, same visual pattern as theme toggle for consistency.

---

## Claude's Discretion

- Light theme exact oklch values (invert lightness, keep hue/chroma)
- General settings panel layout (spacing, grouping)
- i18n translation keys for new settings labels

## Deferred Ideas

None — auto mode stayed within phase scope.
