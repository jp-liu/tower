---
title: Harness
description: Unattended messaging system — Tower is the "record + park + resume" glue, sending and receiving are outsourced to external gateways
---

# Harness Module

**Slug:** `harness`

## Overview

Harness is Tower's **unattended messaging system**. When a task runs autonomously for a long time (L2 unattended mode), the agent needs to reach a human when it is blocked, needs a decision, or wants to report progress — and once the human replies, the task must wake up and continue. This "reach a human → park → resume on reply" capability is what Harness provides.

The core design is a **relay model**:

- **Tower does not connect to Feishu/WeChat and does not send messages itself** (the old built-in SDK send stack has been removed).
- The actual sending and receiving are outsourced to the external gateways **Hermes / OpenClaw** (separate repos / external services).
- Tower does only three glue jobs: **record the question, park the task, and resume it when the reply is injected**.
- The platform-thread ↔ task mapping is maintained on the gateway side, keyed by the token `[[tower:task=<id>]]` carried in every outbound message — the human's reply brings the token back, so the gateway knows which task to route it to.

## Details

### Relay architecture

```
Task Agent (MCP tools)
   │  push_to_human / ask_human / notify_human
   ▼
Tower (record + park/resume; records only, never talks to platforms directly)
   │  push_to_human sends out via the gateway CLI
   ▼
External gateway Hermes / OpenClaw ──► Feishu / WeChat / … (thread↔task map lives on the gateway)
   ▲
   │  human reply (carries the [[tower:task=<id>]] token)
   ▼
relay_channel_reply / reply_to_ask ──► resume the parked task, inject into the live terminal
```

- Tower is agnostic to the concrete IM platform; Feishu et al. are isolated outside the system.
- The outbound body **must** contain the `[[tower:task=<id>]]` token, otherwise the human's reply cannot be attributed to a task and the task stays stuck forever.
- The send destination (group / person) is passed by the caller via `to` for the "work" scope; the "unattended" scope uses a configured owner/home destination.

### The four message tools and how they relate

These four are the easiest to confuse. Keep two axes straight: **does it actually send** and **does it park the task**.

| Tool | Actually sends? | Parks the task? | Purpose |
|------|:---:|:---:|---------|
| `ask_human` | ❌ records only | ✅ park | Low-level state primitive: record an OPEN question + park the task waiting for a reply |
| `notify_human` | ❌ records only | ❌ no park | Low-level state primitive: log one progress line, keep working |
| `push_to_human` | ✅ sends + records | per `expectReply` | High-level one-stop wrapper: send via gateway first, then auto-delegate to ask/notify |
| `reply_to_ask` / `relay_channel_reply` | — (inbound) | resume | Inject the human's reply into a parked task and wake it |

**`ask_human`** — only **records an OPEN question + PARKs the task** (ends the current turn, keeps the PTY alive waiting for a reply); **it does not send anything itself**. It is a low-level state primitive, paired with `reply_to_ask` (park ↔ resume). After calling it you must stop immediately and wait.

**`notify_human`** — only logs a line, does **not** park, keeps working; likewise **does not send**. Use it for milestones / progress broadcasts / FYIs that need no reply.

**`push_to_human`** — **send + record, one-stop**. It sends the message out via the gateway CLI first, and **only after the send succeeds** does it auto-delegate to `ask_human` (`true` → park) or `notify_human` (`false`) based on `expectReply`. It is a high-level wrapper and **only supports the Hermes / OpenClaw** gateways. This is the preferred path when a gateway is configured — it collapses the "send manually + ask manually" two-step.

**`reply_to_ask` / `relay_channel_reply`** — the inbound direction. They bring the human's platform reply back into Tower: mark the OPEN question ANSWERED, resume the parked task, and inject the reply as the task's next message into the live terminal. `relay_channel_reply` additionally parses the `[[tower:task=...]]` token out of the inbound platform message and, via the delivery mapping, decides whether to "answer the ask" or "inject into a work-group discussion".

**Don't mix the two pairings:**

- **"stop and wait for a reply ↔ resume on reply" = `ask_human` ↔ `reply_to_ask`**: the two ends of one flow (one parks, one wakes).
- **"records only, no send ↔ actually sends + records too" = `ask_human` vs `push_to_human`**: the former is a pure state primitive, the latter a send-then-record wrapper.

`list_notify_targets` is the pre-send entry point: it reads the active channel for the current scope and returns **ready-to-follow send instructions** telling the agent which gateway to use and whether to park. The `tower-ask` / `tower-goal` skills internally call it first, then do what it says.

### Notification center `/harness`

The `/harness` route is the human-facing surface for this system — a table laying out every outbound message and its reply:

| Column | Content |
|--------|---------|
| Workspace / Project / Task | Message ownership |
| Content / Sent at | Outbound message and timestamp |
| Reply / Replied at | Human reply and timestamp |
| Status | OPEN (waiting) / answered / notify-only, etc. |
| Actions | View detail / Handle |

- Long content is **truncated to 3 lines** with a hover tooltip for the full text.
- The "view detail / handle" dialog lays out **sent + reply stacked**, and the human can **reply inline** — the reply goes through `reply_to_ask` and resumes the corresponding task directly.
- With no channel configured, `ask_human` still records the question into the `/harness` panel and parks the task, but nothing can be sent out; configure and activate a channel under Settings → Notifications.

### PTY keepalive during an ask wait

When `ask_human` parks a task, it **only sets the execution to PAUSED — it does not kill the PTY**:

- While parked, the **WS-disconnect keepalive teardown is suspended** — so the terminal is not destroyed during the wait for a reply just because the client disconnected (default keepalive is 2h while running).
- The human's reply is **injected directly into the live terminal** (`already_running`), continuing from the previous context, rather than a full `--resume` rerun from scratch.
- This path was fixed in commit `ecab514`.

## Known limitations / future work

- **Claude CLI native option menus are avoided by guidance** (**shipped**, not a detector): the native blocking interactions (`AskUserQuestion` / plan option menu) are invisible to Tower and deadlock the moment no human is watching that terminal. The shipped principle lives in the built-in system directives (`task.systemDirective` / `task.workbenchDirective`, see `src/lib/config-defaults.ts`): **a native menu is only usable when a real human is actively watching *this* terminal** — i.e. **no parent + attended** (case ①: the person picks on the spot, offering options is encouraged). Everywhere else, route the **question plus its options** up the ladder (upward only: child → parent → human):
  - **A derived child task (attended or not)**: the human watches the parent, not the child terminal → never idle on a native menu; write the blocker + options as a plain-text final message and end the turn. The stop hook → `notify-parent` (`src/lib/derive/notify-parent.ts`) wakes the parent, which injects its decision back via `send_task_terminal_input`; if the parent can't decide either it escalates further up to a human.
  - **No parent + unattended**: put the question + options into `ask_human` / `push_to_human`.
  - **When the parent can't decide either**: attended → present the options in its own terminal for the human (native menu OK); unattended → `ask_human` / `push_to_human`.
  - Anti-loop: when reviewing a stuck child the parent **must not bounce the same question straight back down** (this rule is also written into the parent-wake guidance in `child-review-prompt.ts`).
  "A child asking the parent mid-run" reuses the existing stop hook → notify-parent completion path — no new mid-run channel is needed; ending the turn with the blocker as the final reply is enough to surface it to the parent. Whether a decision is "beyond me" is judged by the agent itself (guided by the directive), **not by any deterministic detector**.
- **SessionStart hook fails to load inside a worktree**: a `node:internal/modules/cjs/loader:1424` error prevents `execution.sessionId` from being saved, making the `--resume` fallback unreliable. After the keepalive fix this path is rarely hit, but it remains a separate open issue.

## File Reference

### MCP Tools (`src/mcp/tools/harness-tools.ts`)

- `list_notify_targets` / `push_to_human` / `ask_human` / `notify_human` / `reply_to_ask` / `relay_channel_reply`

### Core Library (`src/lib/harness/`)

| File | Description |
|------|-------------|
| `gateway-send.ts` | Outbound send via the Hermes / OpenClaw gateway CLI |
| `gateway-config.ts` | Gateway runtime config (display name, profile, env) |
| `delivery-map.ts` | Platform message id ↔ task delivery mapping; `[[tower:task=...]]` token extraction |
| `harness-message.ts` | Message lifecycle (OPEN/ANSWERED/…); Tower records only, never sends |

### API Routes (internal bridge, `src/app/api/internal/harness/`)

| Route | Description |
|-------|-------------|
| `POST /ask` | Record an OPEN question + park the execution (PAUSED) |
| `POST /reply` | Inject the reply, resume the task; no OPEN ask → 409 |
| `POST /notify` | Record one progress-log line |

### Notification Center

- `src/app/harness/harness-client.tsx` — the `/harness` table UI, detail/handle dialog, inline reply

### PTY Keepalive (`src/lib/pty/`)

- `session-store.ts` / `ws-server.ts` / `pty-session.ts` — suspend disconnect keepalive while parked, inject the reply into the live terminal

## Related

- Full MCP tool overview: [MCP module](./mcp)
- Terminal and disconnect keepalive: [Terminal module](./terminal)
