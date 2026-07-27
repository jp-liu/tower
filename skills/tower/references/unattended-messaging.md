# Tower unattended · send/receive contract

Tower records and resumes task conversations, and for configured Hermes/OpenClaw channels it can also push outbound messages through the gateway CLI. Legacy ask/reply uses task delivery mappings; ordinary gateway messages additionally use durable project/thread sessions. Tower does these things:

1. **Record** every ask/notify/done/failed (the `/harness` panel is the operations log).
2. **park / resume** the task-execution lifecycle (external tools can't touch this).
3. Push outbound messages for Hermes/OpenClaw-backed channels via `push_to_human`.
4. Define **this contract** for any agent/bridge (bot, OpenClaw, Hermes…) to follow.
5. Persist project discussion/Workbench session bindings plus deduplicated inbound and retryable outbound envelopes.

Feishu/WhatsApp/Slack/etc. are downstream platforms, not Tower gateways. Tower supports Hermes and OpenClaw as sending gateways; each gateway decides how far it can resolve names for a given downstream platform.

---

## Roles

| Role | Who | Does what |
|------|-----|-----------|
| **tower-goal (unattended)** | A task that activated the `tower-goal` skill at run time | Activating it (`/tower-goal <goal>`) enters unattended autonomous run: work silently toward the goal, and on stuck/done push out via tower-ask and park. Activation = authorization (may create tasks, act as the hub for child tasks). **Entered by human activation, not decided by a backend flag.** |
| **tower-ask (outbound)** | The task agent (`tower-ask` skill) | Call `list_notify_targets` to get ready-to-follow send instructions. Hermes/OpenClaw-backed channels use `push_to_human` (send first, then record/park atomically). |
| **bridge (inbound)** | A long-running MCP agent (bot / OpenClaw / …) | Receive each platform message and call `route_gateway_message`. Tower preserves legacy task replies, routes direct/Tower requests locally, and binds project discussion/work to the correct project session. |
| **tower-bridge (routing)** | The task agent (`tower-bridge` skill) | Route prepared content from a task to a human channel, `o-tower`, a sibling task, or a specialist operator such as `xiao-fei`. Human sends still use `tower-ask`; agent/task handoff uses Tower terminal or gateway-native delegation. |

> `tower-goal` / `tower-ask` / `tower-bridge` are **real callable skills** distributed with Tower into task-agent skill homes. Lowercase `bridge` is still this doc's name for the inbound gateway role.

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
2. The bridge calls **`route_gateway_message`** with the inbound message id, replied-to id, platform/chat/thread/root ids, sender id, content, and one of `DIRECT`, `TOWER`, `PROJECT_DISCUSSION`, or `PROJECT_WORK`.
3. Tower first checks durable delivery/task mappings and `[[tower:task=<taskId>]]`. A matching task reply is relayed through the existing **`relay_channel_reply`** path — **not** a bare `send_task_terminal_input`.
   - Pass `platform` and `chatId` whenever available (Feishu `chatId` is usually `oc_xxx`). Tower uses this to recognize whether the reply came from the configured work group or unattended home channel.
   - If the referenced outbound message was an ask, Tower marks it answered, resumes the task, and injects the reply.
   - If the referenced outbound message was a work-channel notify, Tower injects the reply into the live task terminal without consuming any unrelated open ask on the same task.
4. Follow the returned mode. Ambiguous project routes return candidates and require selection; project work is only queued at this point and must not be described as a created task.
   - `in_progress` and `already_processed` always carry `noOp: true`: acknowledge nothing and do not repeat the original answer, Tower mutation, discussion generation, or queue confirmation.

## Non-task messages (create / query)

What reaches the bridge isn't always an answer to some ask. `route_gateway_message` persists every inbound envelope and separates ordinary gateway Q&A, Tower MCP operations, project discussion, and project work. Project discussions must use the returned project context and finish with `complete_gateway_discussion`. Project work is confirmed only by the bound Workbench through `confirm_gateway_task_created`, then completed after review through `complete_gateway_work`.

---

## One-line contract

> Gateways own transport and first-hop routing; Workbenches own project context and review; the Durable Coordinator owns deduplication, queueing, safe-boundary delivery, and retry. `[[tower:task=<id>]]` remains compatible for task replies.
