# Tower unattended · send/receive contract

Tower **does not send or receive platform messages**, and keeps no "task ↔ chat/group" binding. Tower does only three things:

1. **Record** every ask/notify/done/failed (the `/harness` panel is the operations log).
2. **park / resume** the task-execution lifecycle (external tools can't touch this).
3. Define **this contract** for any agent/bridge (bot, OpenClaw, Hermes…) to follow.

Actually delivering messages to Feishu/WeChat/… and bringing human replies back is done by the **agent using its own mounted platform MCP**. Platform protocols, credentials, and connections are **kept entirely outside Tower**.

---

## Roles

| Role | Who | Does what |
|------|-----|-----------|
| **tower-goal (unattended)** | A task that activated the `tower-goal` skill at run time | Activating it (`/tower-goal <goal>`) enters unattended autonomous run: work silently toward the goal, and on stuck/done push out via tower-ask + `ask_human` park. Activation = authorization (may create tasks, act as the hub for child tasks). **Entered by human activation, not decided by a backend flag.** |
| **tower-ask (outbound)** | The task agent (`tower-ask` skill) | Call `list_notify_targets` to get "ready-to-follow send instructions with the real channel filled in" → send via the platform MCP (with the token) → then call `ask_human`/`notify_human` so Tower records + parks. |
| **bridge (inbound)** | A long-running MCP agent (bot / OpenClaw / …) | Receive the human's reply on the platform → recover the taskId → deliver it via `reply_to_ask(taskId, text)`. Non-task messages (create/query) go through ordinary MCP tools. |

> `tower-goal` / `tower-ask` are now **real callable skills** (`skills/tower-goal`, `skills/tower-ask`, distributed with Tower into `~/.claude/skills`); `bridge` is still just this doc's name for the **inbound role**, not a skill.

---

## Outbound: how to get a message to a human

When a task agent needs to ask or report while unattended:

1. **Pick the tool**
   - `ask_human`: blocked, needs a decision, or sign-off before a risky/irreversible action. **Blocks + ends your turn**; the task is parked.
   - `notify_human`: milestone / progress / FYI. **Non-blocking**, keep working.

2. **Compose the message; it MUST carry the token** (hard rule)
   The body **must contain the token verbatim** — the bridge uses it to map "this thread on the platform" back to a taskId:

   ```
   [[tower:task=<taskId>]]
   ```

   Missing the token = the human's reply can't be attributed = the task is stuck forever.

3. **Send it over one "gateway → downstream" channel**
   Channels come from the registry in Settings (`harness.targets`); each has a `gateway` (feishu/openclaw/hermes) + `downstream` (wechat/feishu/qq/… or custom). **State which group/person in the message** (the registry does not preset a destination). Phrase per gateway:

   **Unified message template (fill in the blanks):**

   ```
   [to] <group or person> | [message] <body> | [[tower:task=<taskId>]]
   ```

   - `gateway=feishu` → send directly via the Feishu MCP: `mcp__feishu__im_v1_message_create` to `<to>`, body carrying the token.
   - `gateway=openclaw` / `hermes` (gateway relays to a downstream):
     > via **openclaw** over **WeChat** to the "backend on-call group": the login refactor needs your call… `[[tower:task=cxxx]]`

   — `downstream` decides "over what"; the destination (group/person) is given in the message body. **If you only have a name (group/person) and no platform id, look the id up via the platform MCP first, then send** (same logic as the "Test" button).

4. **Only after the send succeeds, call Tower to record**:
   - `ask_human(taskId, question)` — **record + park** (ends your turn, waits for a reply).
   - `notify_human(taskId, message)` — **record only, no park, doesn't end your turn** (keep working).
   - These tools **only log inside Tower and never send**; the order MUST be "steps 1–3 send via platform MCP → confirm success → then call them".

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
2. The bridge **recovers the taskId** from the `[[tower:task=<taskId>]]` token in the thread/context (the bridge maintains this "thread ↔ taskId" map itself; Tower doesn't).
3. The bridge calls **`reply_to_ask(taskId, text)`** — **not** a bare `send_task_terminal_input`.
   `reply_to_ask` will: mark the ask answered + **record the reply** (visible in the `/harness` log) + resume the session + inject the reply as the task's next message.
4. If it returns `{ no_pending: true }`: the task has no pending question → handle the message as an **ordinary request** (`create_task` / `search` / …).

## Non-task messages (create / query)

What reaches the bridge isn't always an answer to some ask. Anything with no token, or where `reply_to_ask` returns `no_pending`, is handled with ordinary Tower MCP tools as usual, **outside the harness log** (the harness log only captures the ask question-and-answer loop). To also trace ordinary MCP operations later, add instrumentation at the MCP layer — no change to this contract.

---

## One-line contract

> Tower records + park/resume; the agent sends/receives via a platform MCP; the `[[tower:task=<id>]]` token is the only attribution key; replies always go through `reply_to_ask`.
