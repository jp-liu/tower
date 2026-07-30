---
title: Gateway Message Cards
description: Information hierarchy, status presentation, and acceptance rules for native Feishu reply cards
---

# Gateway Message Cards

Tower replies to the original Feishu message with a native interactive card.
The card is a reviewed Workbench conclusion, not a dump of terminal output.

![Real Feishu card acceptance](/diagrams/feishu-card-e2e-2026-07-29.jpeg)

## Three-stage feedback

### Request entered Workbench

“⏳ 小塔 · 请求已进入工作台” means only that the request was persisted and
dispatched:

- it shows the project and current orchestration stage;
- it explicitly avoids claiming that a task exists;
- it includes the request ID for diagnostics.

### Task created

“🚀 小塔 · 任务已创建” uses a compact two-column fact grid:

- status and priority;
- project and workspace;
- execution mode and branch;
- the task goal in a separate section;
- the authoritative Tower task ID in the footer.

Internal enums are localized for people. For example, `IN_PROGRESS` becomes
“执行中”, `LOW` becomes “🔵 低”, and a task without a separate branch shows
“默认工作树”.

### Task completed

“✅ 小塔 · 任务已完成” separates:

1. the result accepted by Workbench;
2. commit and branch metadata;
3. the same Tower task ID shown by the creation card.

When no commit exists, the card shows “无提交” instead of an internal placeholder
such as `none No commit recorded`.

## Delivery contract

- The platform message must be a native reply to the original parent.
- The card payload is persisted in the outbox before delivery.
- Stable semantic deduplication keys prevent duplicate cards during retries.
- Delivery succeeds only after the receipt confirms the `interactive` type and
  the correct parent ID.
- Structured text is used only when the platform cannot render a native card.

## Design principles

- The first screen contains only information needed for a decision.
- Status and risk take priority over internal implementation fields.
- Long goals and results have their own sections instead of sharing a metadata
  paragraph.
- Terminal output is evidence, not the final answer.
- Request and task IDs remain in a visually quiet footer for diagnostics.
