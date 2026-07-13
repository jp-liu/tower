---
name: tower-ask
description: Actually deliver a message to a human/group from a task terminal (the "send" half of unattended messaging). Use whenever the intent is to send/notify/tell/report something to a person or group — "send to X", "notify the backend group", "tell the boss", "report progress to X". tower-goal calls this internally.
---

# tower-ask — deliver a message to a human

Tower's `ask_human` / `notify_human` tools **only record + park inside Tower; they never send anything out**. To actually reach a person you must send first. For configured **Hermes/OpenClaw** channels, prefer Tower's `push_to_human` tool: it sends through the gateway first and only then records/parks.

## When to use

Use only when the user explicitly asks to get content to a real person/group ("send X to the backend on-call group", "tell the boss…", "report progress to…"), or when the task has explicitly entered **tower-goal** and must push a blocker/result off-hours.

**Plain Goal / long-running task mode is NOT tower-goal.** Do not infer unattended messaging from a generic UI goal, a running task title, or "goal mode" wording unless `/tower-goal` was activated (or `set_goal_mode` is already on for this task). For ordinary goal/task runs, report in the terminal/Tower only; don't push a human message unless the user asked for that outbound send.

**Not this skill**: writing to code/files, leaving a PR comment, terminal-internal actions — don't trigger.

## Three steps

### 1. Pick the scope, then get ready-to-follow send instructions

Channels come in two classes — decide which this is:

| scope | when | behavior |
|-------|------|----------|
| **`work`** | You're at the keyboard (working hours), the user explicitly tells you to **send to a group/person to discuss** ("send to Feishu group A… tell me the outcome") | Destination given by the instruction; after sending **don't park, don't close the terminal** — wait for the user to reply in the terminal |
| **`unattended`** | You're away (`tower-goal` off-hours run), you need the **owner to decide** | Destination = the owner; if a reply is needed to continue, `ask_human` **parks** and waits for a bridge-injected reply |

Rule of thumb: **user named a specific group/person → `work`; nobody named, you need the owner to decide → `unattended`.**

Call **`list_notify_targets`** (always pass the current `taskId` = env `TOWER_TASK_ID`):

- **User explicitly named a group/person** → pass `scope: "work"` (overrides the default).
- **Nobody named, you just need the owner** → **omit `scope`** and let the tool derive it from the task's goal-mode flag: goal mode on (`set_goal_mode` was set) → `unattended` (reach the owner); otherwise → `work`. This keeps you correct even if your context was compacted and you forgot whether you're looping.

It **reads the active channel of that scope from Tower's DB** and returns assembled `instructions` — real gateway (OpenClaw / Hermes), downstream platform, destination guidance, the `[[tower:task=<id>]]` token filled with your taskId, and whether to park. **Just do what `instructions` says.**

If the active gateway is **Hermes** or **OpenClaw**, use:

```text
push_to_human({ taskId, message, scope, to, expectReply })
```

It sends first, then records:
- `expectReply: true` → `ask_human` + park.
- `expectReply: false` → `notify_human` + keep working.

- If it returns `{ noChannelConfigured: true }` → **don't pretend you sent it**. For `work`, pass the group/person name from the user's request as `to`; for `unattended`, follow the `instructions` to tell the user to configure a channel under Settings → Notifications and mark it active, then stop.

### 2. Resolve the destination

The destination (group/person name) comes from the **triggering context** ("send to the backend on-call group"). For `work`, pass that name/id as `to` to `push_to_human`; Tower resolves exact ids, `harness.destinations` aliases, and gateway directory entries where available. If the gateway cannot resolve it, it will fail clearly.

### Inbound Replies

When the bridge receives a platform message that contains or quotes `[[tower:task=...]]`, call:

```text
relay_channel_reply({ text, taskId, platform, chatId, platformMessageId, quotedText })
```

Pass `platform` and `chatId` whenever the bridge has them (for Feishu, `chatId` is usually `oc_xxx`). Pass the replied-to platform message id when available. Tower uses message id first, then chat id, to distinguish "this answers an unattended ask" from "this is a work-channel discussion reply", even when both messages belong to the same task.

### 3. Send per instructions, then record

Send via the gateway named in `instructions`; the body **must contain the token verbatim**. Only **after the send succeeds**, call a Tower tool to record:

- Need a **reply** to continue (decision / missing info / sign-off on a risky action) → `push_to_human(..., expectReply: true)` sends + records + parks in the right order.
- Just a **heads-up / progress / FYI**, no reply needed → `push_to_human(..., expectReply: false)` sends + records, no park, keep working.

Keep the recorded `content` the same as what you sent (the token may be omitted in the record) so the `/harness` panel shows "what was asked" accurately.

## Hard rules

- **Unattended (`unattended`) messages start the body with `【task title】`.** The `[[tower:task=id]]` token is for machines, but when several goals run in parallel the human can't tell which task a WeChat message belongs to; the `【title】` prefix lets them tell at a glance and reply without crossing wires. `list_notify_targets`'s `instructions` fills in the concrete title — just follow it. **Work-scope group messages don't need it.**
- **Always send directly, no double-confirming.** Once you recognize a "send to X" intent, send it — don't ask "should I send?".
- **If the platform send fails, never call `ask_human`** (else the task parks but nobody got the message — dead forever). Retry, or leave the message in the `/harness` panel and stop.
- **Order is fixed**: send + confirm success → then `ask_human`/`notify_human`. Those tools do not send. For Hermes/OpenClaw, `push_to_human` enforces this order.
- One pending ask per task at a time (`ask_human` auto-cancels the previous OPEN ask); `[[tower:task=<id>]]` is the idempotency key.

## One-line contract

> Hermes/OpenClaw: `push_to_human` does send + record. The `[[tower:task=<id>]]` token is the portable attribution key.
