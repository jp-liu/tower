---
title: Harness
description: Unattended messaging + parent-child communication + stuck-escalation ladder — Tower is the "record + park + resume" glue
---

# Harness Module

**Slug:** `harness`

## Overview

Harness is Tower's **unattended collaboration system**. When a task runs autonomously for a long time (L2 unattended mode), or was derived by a parent task to chase a sub-goal, the agent needs to reach whoever can make the call when it is **blocked, needs a decision, or wants to report progress** — and once that person decides, the task must wake up and continue. This "reach the one above → park → resume on reply" capability is Harness.

It is three pieces wired into one chain:

1. **Relay messaging**: the agent sends to a human / receives a reply, with send/receive outsourced to external gateways ([Relay architecture](#relay-architecture)).
2. **Parent-child communication**: when a derived child gets stuck it does not bother a human first — it reports back to the **parent** to decide ([Parent-child derivation](#parent-child-derivation)).
3. **Stuck-escalation ladder**: a "who is watching this terminal → who to reach" decision that **hard-bans** the native blocking question (`AskUserQuestion` menu) on terminals nobody is watching, forcing the child → parent → human path instead ([Escalation ladder](#escalation-ladder-guidance--hard-ban)).

The core design is a **relay model**:

- **Tower does not connect to Feishu/WeChat and does not send messages itself** (the old built-in SDK send stack has been removed).
- The actual sending and receiving are outsourced to the external gateways **Hermes / OpenClaw** (separate repos / external services).
- Tower owns **question recording, explicit park/resume, durable project sessions, reliable queueing, and outbound retry**; the gateway owns platform transport, first-hop intent classification, and external-capability delegation.
- Legacy ask/task replies keep using `[[tower:task=<id>]]` and delivery mappings. Ordinary project messages use Tower-owned platform/chat/thread/root-message ↔ project session bindings.

> **Companion diagrams** (self-contained HTML under `docs/diagrams/`, openable standalone):
> - Unattended message relay: `docs/diagrams/tower-harness-flow-en.html` (ZH: drop the `-en`)
> - Parent-child + escalation ladder: `docs/diagrams/tower-escalation-ladder-en.html` (ZH: drop the `-en`)

## Details

### Relay architecture

```
Task Agent (MCP tools)
   │  push_to_human / ask_human / notify_human
   ▼
Tower (record + park/resume; records only, never talks to platforms directly)
   │  push_to_human sends out via the gateway CLI
   ▼
External gateway Hermes / OpenClaw ──► Feishu / WeChat / …
   ▲
   │  human reply (carries the [[tower:task=<id>]] token)
   ▼
reply_to_ask ──► answer an OPEN ask and resume the parked task

ordinary inbound ──► OpenClaw identity / intent / capability routing
                     ├─ ordinary Q&A / external operation ──► OpenClaw capability (outside Tower)
                     └─ Tower message ──► route_gateway_message / route_gateway_query

reply to Tower delivery ──► resolve_gateway_task_context (read-only)
                            ├─ query: read-only tools, no terminal resume
                            ├─ OPEN ask: reply_to_ask
                            ├─ external operation: delegate with towerContext; Tower unchanged
                            └─ explicit development continuation: continue_bound_task (OWNER + idempotent)
```

See `docs/diagrams/tower-harness-flow-en.html` (EN) / `tower-harness-flow.html` (ZH).

- Tower is agnostic to the concrete IM platform; Feishu et al. are isolated outside the system.
- The outbound body **must** contain the `[[tower:task=<id>]]` token, otherwise the human's reply cannot be attributed to a task and the task stays stuck forever.
- The send destination (group / person) is passed by the caller via `to` for the "work" scope; the "unattended" scope uses a configured owner/home destination.

### Message tools and how they relate

These four are the easiest to confuse. Keep two axes straight: **does it actually send** and **does it park the task**.

| Tool | Actually sends? | Parks the task? | Purpose |
|------|:---:|:---:|---------|
| `ask_human` | ❌ records only | ✅ park | Low-level state primitive: record an OPEN question + park the task waiting for a reply |
| `notify_human` | ❌ records only | ❌ no park | Low-level state primitive: log one progress line, keep working |
| `push_to_human` | ✅ persists + sends | per `expectReply` | Persist an outbox and ask intent first, then send and record atomically |
| `reply_to_ask` | — (inbound) | resume | Answer only the current OPEN ask and wake the parked task |
| `resolve_gateway_task_context` | — (read-only) | no | Resolve project/task, status, and latest result without an inbound row or terminal side effect |
| `continue_bound_task` | — (explicit action) | yes | On an explicit OWNER continuation, resume and inject once per platform message id |
| `relay_channel_reply` | — (compatibility) | OPEN ask only | Ordinary task replies return context and no longer resume implicitly |

**`ask_human`** — only **records an OPEN question + PARKs the task** (ends the current turn, keeps the PTY alive waiting for a reply); **it does not send anything itself**. It is a low-level state primitive, paired with `reply_to_ask` (park ↔ resume). After calling it you must stop immediately and wait.

**`notify_human`** — only logs a line, does **not** park, keeps working; likewise **does not send**. Use it for milestones / progress broadcasts / FYIs that need no reply.

**`push_to_human`** — **persist + send + record, one-stop**. Tower first
creates `HarnessMessage(PENDING_DELIVERY)` and `HarnessOutbound` in one
transaction. A worker then sends through Hermes / OpenClaw. After a verifiable
platform message ID is returned, delivery mapping, OPEN ask, and task parking
commit together. Explicit failures remain retryable; send evidence without a
complete receipt becomes `SENT_UNVERIFIED` and is not blindly resent.

**`reply_to_ask`** is the normal OPEN-ask answer action: atomically mark the question answered, resume the parked task, and inject the answer. `relay_channel_reply` remains only for old-client compatibility: it may answer a matching OPEN ask, but an ordinary task reply returns context without injecting or resuming.

**`resolve_gateway_task_context` / `continue_bound_task`** separate association from execution. The resolver returns the subject, producer, Workbench, task status, OPEN-ask state, and latest execution summary without writes. The continuation tool is the OWNER-only side effect for explicit "continue", "fix from this failure", or "rerun" intent. If the same platform message was already persisted as read-only `task_context`, continuation atomically upgrades that `GatewayInbound`; failed or expired claims retry on the same row. Terminal injection uses the inbound ID as a per-session idempotency key so an uncertain response cannot submit the instruction twice.

**Don't mix the two pairings:**

- **"stop and wait for a reply ↔ resume on reply" = `ask_human` ↔ `reply_to_ask`**: the two ends of one flow (one parks, one wakes).
- **"records only ↔ persists before sending" = `ask_human` vs `push_to_human`**:
  the former is a state primitive; the latter is a durable outbox wrapper.

`list_notify_targets` is the pre-send entry point: it reads the active channel for the current scope and returns **ready-to-follow send instructions** telling the agent which gateway to use and whether to park. The `tower-ask` / `tower-goal` skills internally call it first, then do what it says.

`route_gateway_message` is the OWNER entry point for Tower-related messages. Ordinary Q&A and external capabilities remain in OpenClaw and never call Tower. Old clients that send `DIRECT` receive `direct_not_supported` without a `GatewayInbound` row. Stateful routing persists and deduplicates first, then resolves reply/task binding → thread/session binding → explicit project → one identify_project match → sender's recent project → channel default. Project discussion replies use `complete_gateway_discussion`. Project work is only queued for the Workbench; the Workbench calls `confirm_gateway_task_created` after a real `create_task` result and `complete_gateway_work` after review.

A duplicate platform message never replays an action: processing/queued rows return `in_progress + noOp`, while completed rows return `already_processed + noOp`. Threadless discussions reuse a chat + sender scoped session, with recent project context expiring after seven days. Failed deliveries are retried at `nextAttemptAt` by one process-local `unref` timer in addition to startup recovery.

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

### PTY keepalive during an ask wait · reply injected into the live terminal

When `ask_human` parks a task it takes the "**park, don't kill**" path rather than "kill then `--resume`", so context survives the wait:

1. **Set PAUSED only, never kill the PTY**: the execution is marked PAUSED and the PTY session is left intact.
2. **Suspend the disconnect keepalive teardown**: while parked the **WS-disconnect keepalive timer is suspended** — so the terminal is not reclaimed during the wait just because the client disconnected (default keepalive is 2h while running).
3. **Inject the reply into the live terminal**: on reply, `reply_to_ask` flips the execution back to RUNNING and injects the reply as the next message **into the same live PTY** (`already_running`), continuing from the prior context rather than a full `--resume` rerun from scratch.

This path was fixed in commit `ecab514`. Implemented across `src/lib/pty/{session-store,ws-server,pty-session}.ts`.

### Parent-child derivation

A task can be **derived by another task**: the child's `parentTaskId` points back to the parent, and the child's description carries a `## 来源` section noting "父任务派生" (derived by parent). Parent and child need no new mid-run channel — they **reuse the existing stop-hook fan-out**:

- When the child **ends a turn** (stop hook) → `POST /api/internal/hooks/stop` fans out to `notify-parent` (`src/lib/derive/notify-parent.ts`).
- Codex keeps both its Stop hook and the `agent-turn-complete` notifier. Both paths use the same Codex turn id for deduplication, so completing a turn persists the parent event without requiring the reusable PTY to close.
- `notifyParentOnChildStop` resolves the parent and first persists a `WorkbenchEvent` under a stable `dedupKey`; events remain pending while the parent is not running instead of being dropped.
- The parent's own stop hook is the safe drain boundary. Ordinary completion, decision, and failure events for one parent are coalesced into one review batch, persisted as a `TaskMessage(SYSTEM)`, and only then written to the PTY. Failed delivery returns to `PENDING`; expired claims are recovered at startup.
- Every provider's execution completion uses one fallback: FAILED always creates a high-priority event, while COMPLETED adds a normal review only when that execution has no stop-hook review/decision. The producers atomically compete on a unique `executionReviewKey` to avoid duplicates.

So "a child asking the parent mid-run" needs no dedicated mid-run channel — **ending the turn with the blocker as the final reply** is enough; the stop hook surfaces it to the parent. The parent decides during its review and injects the decision back into the child's terminal via `send_task_terminal_input`.

### Escalation ladder (guidance + hard-ban)

Native blocking interactions (`AskUserQuestion` / plan option menu) are ones **Tower can neither see nor click on the human's behalf** — the moment nobody is watching that terminal they deadlock the task forever. So Harness puts a **two-layer block** on them (**both shipped**): a **guidance layer** tells the agent which path to take, and an **enforcement layer** uses a PreToolUse hook to `deny` the menu that shouldn't pop.

See `docs/diagrams/tower-escalation-ladder-en.html` (EN) / `tower-escalation-ladder.html` (ZH).

The decision looks at just two axes — **has a parent or not** × **is a human watching this terminal or not** — giving four cases. Principle: **a native menu is usable only when a real human is actively watching *this* terminal**; everywhere else, route the **question plus its concrete options** up the ladder, **upward only** (child → parent → human):

| Case | Native menu | What to do |
|------|:---:|------|
| **① no parent + attended** | ✅ allowed (encouraged) | A human is watching this terminal; picks on the spot. Don't flatten options into prose — pop `AskUserQuestion`. |
| **② no parent + unattended** | ✘ hard-banned | Put question + options into `ask_human` (needs a reply → stop and wait) or `push_to_human`, sent straight to the human. |
| **③ has parent + attended** | ✘ hard-banned | The human watches the **parent**, not you. Write blocker + options as a plain-text final message and end the turn → stop hook → `notify-parent` wakes the parent to decide. |
| **④ has parent + unattended** | ✘ hard-banned | Same as ③: end plain-text and report up to the parent; if the parent can't decide, the **parent** escalates further to a human. |

- **When the parent can't decide either**: attended → present the options in the parent's own terminal for the human (native menu OK); unattended → `ask_human` / `push_to_human`.
- **Anti-loop**: when reviewing a stuck child the parent **must not bounce the same question straight back down** (this rule is also written into the parent-wake guidance in `child-review-prompt.ts`). Whether a decision is "beyond me" is the agent's own judgment (guided by the directive), **not any deterministic detector**.

**Guidance layer** — the four-case principle lives in the built-in system directives `task.systemDirective` / `task.workbenchDirective` (the escalation-ladder section of `src/lib/config-defaults.ts`).

**Enforcement layer** — a PreToolUse hook `scripts/tower-pre-tool-hook.js` (one script shared by Claude + Codex) whose **`deny` is verified to take effect** under `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox`:

- **Blocked target** is each provider's interactive-question tool name — **Claude = `AskUserQuestion`, Codex = `request_user_input` (different names!)**, both verified live. One script lists both; a session only ever exposes its own provider's name, so listing both is harmless. Every other tool passes through.
- **Decision**: `allow ⇔ no parent AND attended (case ①)`; `deny ⇔ has parent OR unattended (②③④)`, returning `permissionDecision:"deny"` plus a note pointing the agent at the ladder.
- **State comes from spawn-time env** (the PTY strips `TOWER_DATA_DIR`, so the resolved path is injected directly):
  - `TOWER_HAS_PARENT` — injected when `parentTaskId` is set (static).
  - `TOWER_SIGNAL_DIR` — the signal dir; the file `unattended-<taskId>` present ⇔ unattended. It is written/removed via `src/lib/harness/unattended-signal.ts` from `set_goal_mode` / status transitions, mirroring the DB `task.unattended` column (the standalone hook has no DB access, so it reads the file). Fail-open: a missing signal file is treated as attended.
- **Codex side**: spawn adds `--dangerously-bypass-hook-trust` and the `[features]` flag is renamed `codex_hooks` → `hooks`; Hermes is a gateway adapter with no PTY, so it's unaffected.

## Known limitations / future work

- **SessionStart hook fails to load inside a worktree**: a `node:internal/modules/cjs/loader:1424` error prevents `execution.sessionId` from being saved, making the `--resume` fallback unreliable. After the keepalive fix this path is rarely hit, but it remains a separate open issue.

## File Reference

### MCP Tools (`src/mcp/tools/harness/`)

- `list_notify_targets` / `push_to_human` / `ask_human` / `notify_human` / `reply_to_ask` / `relay_channel_reply`
- `resolve_gateway_task_context` / `continue_bound_task`
- `route_gateway_message` / `complete_gateway_discussion` / `confirm_gateway_task_created` / `complete_gateway_work`

### Core Library (`src/lib/harness/`)

| File | Description |
|------|-------------|
| `gateway-send.ts` | Outbound send via the Hermes / OpenClaw gateway CLI |
| `gateway-config.ts` | Gateway runtime config (display name, profile, env) |
| `delivery-map.ts` | Platform message id ↔ task delivery mapping; `[[tower:task=...]]` token extraction |
| `gateway-router.ts` | Inbound deduplication, session binding, project resolution, Workbench queueing, and reliable completion delivery |
| `gateway-maintenance.ts` | Read-only Gateway state/byte observation with the seven-day terminal relation predicates; performs no compaction |
| `gateway-output.ts` | Structured message-id extraction from Hermes/OpenClaw send output |
| `harness-message.ts` | Message lifecycle (OPEN/ANSWERED/…); Tower records only, never sends |
| `unattended-signal.ts` | Write/remove the `unattended-<taskId>` signal file read by the PreToolUse hook |

### Parent-child derivation (`src/lib/derive/`)

| File | Description |
|------|-------------|
| `notify-parent.ts` | Child stop → deduplicated insert into the durable Workbench event inbox |
| `child-review-prompt.ts` | The parent-wake guidance prompt (incl. the "don't bounce it back" anti-loop rule) |

### Workbench coordinator (`src/lib/workbench/`)

| File | Description |
|------|-------------|
| `coordinator.ts` | Event enqueue, claim leases, batch aggregation, retry release, and boundary drain |
| `boundary.ts` | In-process completed-turn latch; any new PTY input closes it |
| `maintenance.ts` | Read-only Workbench batch state/byte observation; never mutates `WorkbenchEvent.payload` |

### Hook scripts (`scripts/`)

- `tower-pre-tool-hook.js` — PreToolUse hard-ban of the native question tool (enforcement layer); install/uninstall in `packages/ai-provider-claude/src/adapter.ts`

### System directives (`src/lib/config-defaults.ts`)

- `task.systemDirective` / `task.workbenchDirective` — the four-case escalation-ladder guidance (guidance layer)

### API Routes (internal bridge, `src/app/api/internal/harness/`)

| Route | Description |
|-------|-------------|
| `POST /ask` | Record an OPEN question + park the execution (PAUSED) |
| `POST /reply` | Inject the reply, resume the task; no OPEN ask → 409 |
| `POST /notify` | Record one progress-log line |
| `POST/PATCH/PUT /gateway` | Inbound routing, completion acknowledgement, and retryable discussion/task replies |
| `POST/PUT /gateway-task` | Side-effect-free task binding resolution / OWNER explicit idempotent continuation |

### Notification Center

- `src/app/harness/harness-client.tsx` — the `/harness` table UI, detail/handle dialog, inline reply

### PTY Keepalive (`src/lib/pty/`)

- `session-store.ts` / `ws-server.ts` / `pty-session.ts` — suspend disconnect keepalive while parked, inject the reply into the live terminal

## Related

- Full MCP tool overview: [MCP module](./mcp)
- Terminal and disconnect keepalive: [Terminal module](./terminal)
- Process lifecycle and hook fan-out convention: `.claude/rules/process-lifecycle.md`
