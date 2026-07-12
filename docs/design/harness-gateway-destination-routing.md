# Harness Gateway Destination Routing

## Goal

Tower should support office messaging and unattended messaging through gateway
providers without baking any single chat platform into Tower.

The routing model is:

```text
Tower
  -> gateway: hermes | openclaw
      -> downstream platform: feishu | whatsapp | slack | telegram | ...
          -> destination: human/group name, alias, or platform id
```

`feishu` is not a Tower gateway. It is a downstream platform behind Hermes or
OpenClaw.

## Scopes

- `unattended`: default human owner route. It may use a fixed home destination
  because the owner is stable. A task can park and wait for a reply.
- `work`: in-office collaboration. The sender must provide a destination at
  send time, for example "send this to the 起飞 group". Tower must not assume one
  fixed work group.

## Destination Resolution

Tower resolves a destination in this order:

1. Exact platform id: `feishu:oc_xxx`, `whatsapp:1203...`, raw `oc_xxx`, Slack
   channel id, OpenClaw target, etc.
2. Tower destination aliases from `harness.destinations`.
3. Gateway/platform directory cache where available.
4. Gateway live lookup if the gateway supports it.
5. Clear failure with candidates or setup guidance.

The `harness.destinations` config is intentionally small and portable:

```json
[
  {
    "alias": "起飞",
    "gateway": "hermes",
    "platform": "feishu",
    "dest": "feishu:oc_7117...",
    "scope": "work"
  }
]
```

For platforms with good directories, aliases are just a cache. For platforms
without reliable directory lookup, aliases are the primary mechanism.

## Gateway Capabilities

### Hermes

Hermes can send through its CLI:

```bash
hermes --profile h-tower send --to feishu:oc_xxx --json "message"
```

Tower normalizes common destinations:

- `oc_xxx` + `platform=feishu` -> `feishu:oc_xxx`
- blank unattended destination + `platform=feishu` -> Hermes home channel
- alias/name -> Tower alias cache or Hermes channel directory if populated

### OpenClaw

OpenClaw is also a gateway. Tower should call the OpenClaw CLI directly for
message delivery. OpenClaw uses channel-specific target formats and can resolve
names for providers with directory support.

Tower passes:

- `platform/downstream` as the OpenClaw channel
- `to` as the OpenClaw target
- the message body with the Tower task token appended

OpenClaw may return no platform message id. In that case Tower still records the
harness message, but inbound attribution depends on the `[[tower:task=...]]`
token or later gateway support for returned message ids.

## WhatsApp

The same design works for WhatsApp, but destination resolution is different.
WhatsApp generally uses phone numbers or group/newsletter JIDs rather than a
stable bot-visible group-name directory. Tower should therefore prefer:

- exact WhatsApp target ids from the gateway
- user-maintained aliases such as `项目群 -> <group JID>`

This keeps the Tower API uniform while acknowledging platform limits.

## MCP Tool Contract

`push_to_human` accepts an optional `to`:

```ts
push_to_human({
  taskId,
  scope: "work",
  to: "起飞",
  message: "Please confirm the deployment window.",
  expectReply: false
})
```

Rules:

- work scope: `to` is required unless the active target has a fixed destination
  for backwards compatibility.
- unattended scope: `to` is optional; default to the configured owner/home route.
- every outbound body includes `[[tower:task=<taskId>]]`.
- if sending succeeds, Tower records `notify_human` or `ask_human`.
- if sending fails, Tower does not park the task.
