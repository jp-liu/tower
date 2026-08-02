---
name: tower-ask
description: Deliver an explicit work-scope message to a named human or group from a task terminal. Use for requests such as "send to X", "notify the backend group", or "report progress to X". Unattended OWNER messages use the bounded CapabilityRequest path instead.
---

# tower-ask - deliver an explicit work message

Tower's `ask_human` / `notify_human` tools only record or park inside Tower;
they never send anything out. For an explicit work-scope recipient,
`push_to_human` sends through the configured gateway first and only then
records or parks.

## When to use

Use this skill only when the user explicitly asks to get content to a named
real person or group, for example "send this to the backend on-call group" or
"report progress to Alex".

Unattended OWNER messaging is not this skill. A `tower-goal` task must call
`discover_gateway_capabilities` and `submit_capability_request` with a
UI-issued bounded grant. Never send the same logical message through both
paths.

## Explicit work-message flow

1. Call `list_notify_targets({ taskId, scope: "work" })` with `taskId` from
   `TOWER_TASK_ID`.
2. Take the destination from the user's instruction and pass it as `to`.
   Tower resolves exact ids, configured aliases, and gateway directory entries
   where available.
3. Follow the returned instructions and call:

```text
push_to_human({ taskId, message, scope: "work", to, expectReply })
```

- `expectReply: true` sends, records an ask, and parks.
- `expectReply: false` sends and records a notification without parking.
- `{ noChannelConfigured: true }` means nothing was sent. Report that a work
  channel must be configured under Settings -> Notifications.

## Inbound replies

When the bridge receives a platform message that contains or quotes
`[[tower:task=...]]`, call:

```text
relay_channel_reply({ text, taskId, platform, chatId, platformMessageId, quotedText })
```

Pass platform correlation fields whenever available. Tower uses message id
first and chat id second to distinguish an answer to an open ask from a normal
work-channel discussion reply.

## Hard rules

- Once the user names a recipient and asks to send, send directly without a
  second confirmation.
- If platform delivery fails, never call `ask_human`; otherwise the task parks
  even though nobody received the question.
- Preserve the `[[tower:task=<id>]]` token returned in the instructions.
- One open ask per task is supported; a new ask cancels the previous open ask.
- Never use this path as fallback for a failed or unknown unattended OWNER
  CapabilityRequest.

## One-line contract

> Explicit recipient: `push_to_human` does send plus record. Unattended OWNER: use one authorized CapabilityRequest.
