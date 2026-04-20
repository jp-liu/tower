# Phase 12: Git Path Mapping Rules - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 12-git-path-mapping-rules
**Areas discussed:** Rule data model, Rule matching logic, Settings UI design, Auto-populate integration
**Mode:** auto (all decisions auto-selected)

---

## Rule Data Model

| Option | Description | Selected |
|--------|-------------|----------|
| JSON array in SystemConfig | Store rules as JSON array with key git.pathMappingRules | ✓ |
| Separate Prisma model | New GitPathRule model with proper relations | |
| YAML config file | External config file for rules | |

**User's choice:** [auto] JSON array in SystemConfig (recommended default)
**Notes:** Reuses Phase 11 infrastructure. No schema migration needed. Rules are a small dataset (10-20 entries max) so JSON array is efficient.

---

## Rule Matching Logic

| Option | Description | Selected |
|--------|-------------|----------|
| Host + owner prefix match | Match host exactly, owner as prefix, priority ordering | ✓ |
| Regex-based patterns | Full regex for host and owner matching | |
| Glob patterns | Glob-style wildcards for flexible matching | |

**User's choice:** [auto] Host + owner prefix match with priority (recommended default)
**Notes:** Matches current hardcoded logic pattern. Simple and predictable. Wildcard `*` for catch-all host rules.

---

## Settings UI Design

| Option | Description | Selected |
|--------|-------------|----------|
| Inline table with add/edit/delete | Table of rules with inline editing | ✓ |
| Dialog-based CRUD | Modal dialogs for add/edit | |
| JSON editor | Raw JSON editing of rules | |

**User's choice:** [auto] Inline table with add/edit/delete (recommended default)
**Notes:** Standard settings pattern. No dialog overhead for simple data entry. Inline editing keeps context.

---

## Auto-populate Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Server action wrapper | resolveGitLocalPath server action, async handleGitUrlChange | ✓ |
| Client-side rule cache | Load rules once, match client-side | |
| API route | Dedicated API route for URL resolution | |

**User's choice:** [auto] Server action wrapper (recommended default)
**Notes:** Follows existing server action pattern. Async call from client component is straightforward. No caching complexity.

---

## Claude's Discretion

- Table styling and layout
- Validation messages
- Test/preview button for rules
- Animation on add/edit

## Deferred Ideas

None — auto mode stayed within phase scope.
