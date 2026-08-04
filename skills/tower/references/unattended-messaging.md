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
| **tower-goal (unattended)** | A task that activated the `tower-goal` skill at run time | Activating it (`/tower-goal <goal>`) enters unattended autonomous run: work silently toward the goal, and on stuck/done push out via tower-ask and park. Activation authorizes scheduling inside existing Tower/project permissions, but never grants R2/R3 external side effects. **Entered by human activation, not decided by a backend flag.** |
| **tower-ask (outbound)** | The task agent (`tower-ask` skill) | Call `list_notify_targets` to get ready-to-follow send instructions. Hermes/OpenClaw-backed channels use `push_to_human` (send first, then record/park atomically). |
| **bridge (inbound)** | A long-running MCP agent (bot / OpenClaw / …) | Own first-hop intent routing. Ordinary Q&A/external work stays outside Tower; Tower replies are resolved read-only before an explicit query, ask answer, delegation, or continuation action. |
| **tower-bridge (external capability)** | The task agent (`tower-bridge` skill) | Submit a structured external capability request without choosing a concrete Operator. Human sends use `tower-ask`; sibling-task handoff stays in the `tower` skill. |

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
2. If it replies to a Tower delivery, the bridge calls **`resolve_gateway_task_context`** with the replied-to id, platform/chat ids, and any quoted token. This call is read-only and creates no `GatewayInbound`.
3. The bridge chooses exactly one action from the user's intent:
   - Status/result query: use read-only Tower tools; do not resume.
   - Answer to an OPEN ask: call `reply_to_ask`, which atomically answers and resumes the parked task.
   - External operator work: delegate with the returned `projectId`, `workbenchTaskId`, and `subjectTaskId`; do not mutate Tower.
   - Explicit continue/fix/rerun: call OWNER-only `continue_bound_task` with the inbound platform message id. Tower persists and deduplicates this side effect.
4. Tower-related messages that are not task replies use `route_gateway_message` with `TOWER`, `PROJECT_DISCUSSION`, or `PROJECT_WORK`. Ambiguous project routes require selection; queued work is not yet a created task.
   - `in_progress` and `already_processed` always carry `noOp: true`: acknowledge nothing and do not repeat the original answer, Tower mutation, discussion generation, or queue confirmation.

## Non-task messages (create / query)

Ordinary gateway Q&A and external capabilities do not call Tower. `route_gateway_message` persists only Tower-related envelopes and separates Tower MCP operations, project discussion, and project work. Old clients that send `DIRECT` receive `direct_not_supported` and no inbound row is created. Project discussions must finish with `complete_gateway_discussion`. Project work is confirmed only by the bound Workbench through `confirm_gateway_task_created`, then completed after review through `complete_gateway_work`.

---

## One-line contract

> Gateways own transport, intent, and external delegation; Tower resolves task context read-only; only `reply_to_ask` and `continue_bound_task` may resume a task from a platform reply. Workbenches own project context and review.
