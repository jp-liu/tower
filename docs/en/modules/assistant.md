---
title: Assistant
description: Tower-owned sessions, SSE, attachments, and tool execution
---

# Assistant Module

**Slug:** `assistant`

Tower-owned SQLite sessions and messages are the recovery source. Assistant is not tied to one CLI's transcript. Its slot may use CLI or API connections and follows the same explicit fallback rules as other AI Tools slots.

## Sessions and streaming

- `AssistantSession`, `AssistantTurn`, and `AssistantMessage` store history, titles, and workspace/project/version bindings.
- SSE emits text, reasoning, tool-call, tool-result, usage, finish, and redacted error events. Users can cancel the active turn.
- Fallback is allowed only before the turn's first text, reasoning, tool call, or side effect. Activity locks the connection/model to avoid duplicate output, tools, and charges.
- Image and text attachments pass path, count, type, and size checks. Messages store controlled metadata, never arbitrary host paths.
- The host supplies and executes Tower tools; the model sees only the allowed definitions and results return to the same turn.

## Legacy import

Tower lists up to 50 legacy Claude Agent SDK sessions. Opening or sending to one imports a copy on demand and records `legacySource + legacyId` to prevent duplicates. Failed conversion leaves the original transcript untouched. After import, Tower's database messages provide multi-provider continuation context.

See [Upgrade and migration](/en/guide/upgrading) for data and backup boundaries.
