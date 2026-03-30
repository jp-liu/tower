# Phase 11: SystemConfig Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 11-systemconfig-foundation
**Areas discussed:** Config data model, Settings page integration, Config API design, Default config registry
**Mode:** auto (all decisions auto-selected)

---

## Config Data Model

| Option | Description | Selected |
|--------|-------------|----------|
| Simple key-value with JSON string | key (unique), value (JSON string), timestamps | ✓ |
| Structured with type/group columns | key, value, type enum, group string | |
| JSONB document store | Single row with JSON blob of all config | |

**User's choice:** [auto] Simple key-value with JSON string serialization (recommended default)
**Notes:** Matches SQLite patterns. JSON string values support all needed types (string, number, boolean, object). Dot-notation keys provide logical grouping without a column.

---

## Settings Page Integration

| Option | Description | Selected |
|--------|-------------|----------|
| New nav item in settings | Add "Config" to NAV_ITEMS array after Prompts | ✓ |
| Integrate into General section | Add config controls under existing General settings | |
| Separate route /settings/config | New page with its own URL | |

**User's choice:** [auto] New nav item in settings-nav.tsx (recommended default)
**Notes:** Follows existing pattern. Roadmap explicitly mentions "Config section or equivalent navigation entry". New nav item keeps concerns separated from General (theme/language).

---

## Config API Design

| Option | Description | Selected |
|--------|-------------|----------|
| Generic typed get/set functions | getConfigValue<T>(key, default), setConfigValue(key, value) | ✓ |
| Untyped string-only functions | getConfig(key): string, setConfig(key, value: string) | |
| Config object CRUD | getConfigObject(), updateConfigObject(partial) | |

**User's choice:** [auto] Generic typed functions with JSON serialization (recommended default)
**Notes:** Type-safe at call sites. JSON.parse/stringify handles serialization. Follows existing server action patterns.

---

## Default Config Registry

| Option | Description | Selected |
|--------|-------------|----------|
| Centralized config-defaults.ts | Single file with all keys, types, defaults, labels | ✓ |
| Inline defaults per consumer | Each consumer declares its own default | |
| Database seed defaults | Seed script inserts default rows | |

**User's choice:** [auto] Centralized config-defaults.ts in src/lib/ (recommended default)
**Notes:** Single source of truth. Follows existing constants.ts pattern. Phase 12-13 add entries as they wire parameters.

---

## Claude's Discretion

- Config nav icon choice (Wrench/Sliders/SlidersHorizontal)
- Placeholder UI layout for empty Config section
- Whether to add description column to SystemConfig model

## Deferred Ideas

None — auto mode stayed within phase scope.
