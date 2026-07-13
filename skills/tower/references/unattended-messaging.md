# Tower unattended · send/receive contract

Tower records and resumes task conversations, and for configured Hermes/OpenClaw channels it can also push outbound messages through the gateway CLI. Tower keeps no fixed "task ↔ chat/group" binding. Tower does these things:

1. **Record** every ask/notify/done/failed (the `/harness` panel is the operations log).
2. **park / resume** the task-execution lifecycle (external tools can't touch this).
3. Push outbound messages for Hermes/OpenClaw-backed channels via `push_to_human`.
4. Define **this contract** for any agent/bridge (bot, OpenClaw, Hermes…) to follow.

Feishu/WhatsApp/Slack/etc. are downstream platforms, not Tower gateways. Tower supports Hermes and OpenClaw as sending gateways; each gateway decides how far it can resolve names for a given downstream platform.

---

## Roles

| Role | Who | Does what |
|------|-----|-----------|
| **tower-goal (unattended)** | A task that activated the `tower-goal` skill at run time | Activating it (`/tower-goal <goal>`) enters unattended autonomous run: work silently toward the goal, and on stuck/done push out via tower-ask and park. Activation = authorization (may create tasks, act as the hub for child tasks). **Entered by human activation, not decided by a backend flag.** |
| **tower-ask (outbound)** | The task agent (`tower-ask` skill) | Call `list_notify_targets` to get ready-to-follow send instructions. Hermes/OpenClaw-backed channels use `push_to_human` (send first, then record/park atomically). |
| **bridge (inbound)** | A long-running MCP agent (bot / OpenClaw / …) | Receive the human's reply on the platform → recover the taskId and replied-to message id if available → deliver it via `relay_channel_reply`. Non-task messages (create/query) go through ordinary MCP tools. |

> `tower-goal` / `tower-ask` are now **real callable skills** (`skills/tower-goal`, `skills/tower-ask`, distributed with Tower into `~/.claude/skills`); `bridge` is still just this doc's name for the **inbound role**, not a skill.

---

## Outbound: how to get a message to a human

When a task agent needs to ask or report while unattended:

1. **Pick the path**
   - Hermes/OpenClaw active channel: use `push_to_human({ taskId, message, scope, to, expectReply })`. It sends first, then records with `ask_human` (when `expectReply=true`) or `notify_human` (when false).
   - Work messages pass the destination from the user instruction as `to` (group/person name, alias, or platform id). Unattended messages may omit `to` when the channel has a home/owner route.

2. **Compose the message; it MUST carry the token** (hard rule)
   The body **must contain the token verbatim** — the bridge uses it to map "this thread on the platform" back to a taskId:

   ```
   [[tower:task=<taskId>]]
   ```

   Missing the token = the human's reply can't be attributed = the task is stuck forever.

3. **Send it over one "gateway → downstream" channel**
   Channels come from the registry in Settings (`harness.targets`); each has a `gateway` (openclaw/hermes) + `downstream` (wechat/feishu/whatsapp/slack/… or custom) + optional exact owner/home `dest`.

   **Unified message template (fill in the blanks):**

   ```
   [to] <group or person> | [message] <body> | [[tower:task=<taskId>]]
   ```

   - `gateway=openclaw` → call `push_to_human` with `to`.
   - `gateway=hermes` → call `push_to_human` with `to` for work messages, or omit `to` for unattended home routes.

   — `downstream` decides "over what". Tower resolves exact ids, aliases in `harness.destinations`, and gateway directory entries where available. Some platforms (for example WhatsApp) may need a configured alias/JID rather than a natural group name.

4. **Only after the send succeeds, call Tower to record**:
   - `ask_human(taskId, question)` — **record + park** (ends your turn, waits for a reply).
   - `notify_human(taskId, message)` — **record only, no park, doesn't end your turn** (keep working).
   - These tools **only log inside Tower and never send**; skip this step when using `push_to_human`, because it already records after a successful gateway send.

### Failure & idempotency
- **If the platform send fails, do NOT call `ask_human`** (else the task parks but nobody got the question — stuck forever). Retry, or leave the question in the `/harness` panel and stop.
- One pending ask per task at a time (`ask_human` auto-cancels the previous OPEN ask); the `[[tower:task=<id>]]` token is the idempotency key; `reply_to_ask` is idempotent against an already-answered ask and won't double-inject.

> The recorded `content` should match what you sent (the token may be omitted in the record) so the `/harness` log shows "what was asked" accurately.

> **When no channel is configured** (`harness.targets` empty; `ask_human` returns `noChannelConfigured: true`):
> **Don't pretend you sent it.** Tell the user directly: "configure a channel under **Settings → Notifications → unattended send channels**, otherwise this message can't go out."
> The question is still recorded and visible/answerable in the `/harness` panel — it just won't be pushed to any external channel.

---

## Inbound: how to deliver a reply back to the task

After the human replies on the platform:

1. The reply reaches the **bridge** first (it's connected to the platform — that's its job).
2. The bridge **recovers the taskId** from the `[[tower:task=<taskId>]]` token in the message, quoted/replied-to text, thread context, or its own "thread ↔ taskId" map.
3. The bridge calls **`relay_channel_reply({ text, taskId, platform, chatId, platformMessageId, quotedText })`** — **not** a bare `send_task_terminal_input`.
   - Pass `platform` and `chatId` whenever available (Feishu `chatId` is usually `oc_xxx`). Tower uses this to recognize whether the reply came from the configured work group or unattended home channel.
   - If the referenced outbound message was an ask, Tower marks it answered, resumes the task, and injects the reply.
   - If the referenced outbound message was a work-channel notify, Tower injects the reply into the live task terminal without consuming any unrelated open ask on the same task.
4. If it returns `{ no_task_token: true }` or `{ no_pending: true }`: handle the message as an **ordinary request** (`create_task` / `search` / …).

## Non-task messages (create / query)

What reaches the bridge isn't always an answer to some ask. Anything with no token, or where `reply_to_ask` returns `no_pending`, is handled with ordinary Tower MCP tools as usual, **outside the harness log** (the harness log only captures the ask question-and-answer loop). To also trace ordinary MCP operations later, add instrumentation at the MCP layer — no change to this contract.

---

## One-line contract

> Tower records + park/resume; Hermes/OpenClaw can push via `push_to_human`; the `[[tower:task=<id>]]` token plus platform reply message id/chat id are the attribution keys; external replies go through `relay_channel_reply`.
