# Phase 13: Configurable System Parameters - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 13-configurable-system-parameters
**Areas discussed:** UI Organization, Branch Template Syntax, Config Wiring Pattern, Validation Rules
**Mode:** auto (all areas auto-resolved with recommended defaults)

---

## UI Organization

| Option | Description | Selected |
|--------|-------------|----------|
| Collapsible sections by domain | Group as System / Git / Search sections within system-config.tsx | ✓ |
| Flat list of all parameters | Single long list with no grouping | |
| Separate tabs per domain | Tab navigation within the Config page | |

**User's choice:** [auto] Collapsible sections by domain (recommended default)
**Notes:** Matches dot-notation key namespacing and scales naturally as more parameters are added.

---

## Branch Template Syntax

| Option | Description | Selected |
|--------|-------------|----------|
| {taskId} + {taskIdShort} only | Minimal — full cuid and first-4-chars shorthand | ✓ |
| {taskId} + {taskIdShort} + {taskTitle} | Also include slugified task title | |
| Full Mustache-style templating | Rich template engine with conditionals | |

**User's choice:** [auto] {taskId} + {taskIdShort} only (recommended default)
**Notes:** Matches current `task.id.slice(0, 4)` behavior exactly. Adding more variables can be done later if needed.

---

## Config Wiring Pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Direct getConfigValue at use-sites | Each consumer calls getConfigValue directly — no caching | ✓ |
| React hook wrapper (useConfig) | Client hook that loads + caches config values | |
| Startup-time config snapshot | Load all config at app start, pass down via context | |

**User's choice:** [auto] Direct getConfigValue at use-sites (recommended default)
**Notes:** Phase 14 handles realtime config and potential caching. This phase focuses on wiring the reads correctly.

---

## Validation Rules

| Option | Description | Selected |
|--------|-------------|----------|
| Sensible floor/ceiling ranges | Min/max validation per parameter with practical limits | ✓ |
| Strict business constraints | Very narrow ranges based on expected production use | |
| No validation (free input) | Trust the user, no constraints | |

**User's choice:** [auto] Sensible floor/ceiling ranges (recommended default)
**Notes:** Ranges are practical — upload 1-500 MB, concurrent 1-10, timeout 5-300s, debounce 50-1000ms, snippet 20-500, results 5-100, cap 1-20.

---

## Claude's Discretion

- Exact section heading/description text
- Whether to show "Reset to default" buttons
- Upload size input unit display approach
- Visual spacing and layout

## Deferred Ideas

None — discussion stayed within phase scope.
