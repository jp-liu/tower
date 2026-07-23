---
title: Tower Agent Extension
description: How to extend o-tower with dedicated operator agents for Feishu, mail, knowledge bases, and other external systems
---

**Slug:** `agent-extension`

## Principle

`o-tower` is the Tower entrypoint and coordinator, not an all-purpose executor.

The official Tower profile stays clean by default: Tower MCP plus the `tower`
skill. External systems such as Feishu, mail, Slack, Notion, and company
knowledge bases should be configured as dedicated local operator agents, then
reached through capability routing.

Example:

```yaml
capabilityRoutes:
  tower.task: o-tower
  tower.project: o-tower
  tower.note: o-tower
  feishu.docs: xiao-fei
  feishu.wiki: xiao-fei
  feishu.sheets: xiao-fei
  feishu.bitable: xiao-fei
  feishu.drive: xiao-fei
  feishu.permissions: xiao-fei
```

`o-tower` handles Tower work directly. Feishu document pages, knowledge-base
pages, Sheets, Bitable/Base apps, Drive files, folders, attachments, and
permission checks are delegated to `xiao-fei`, which owns the Feishu MCP/skills
and user credentials.
In the Feishu example, `xiao-fei` is a Feishu workspace operator, not only a
spreadsheet operator. It can own the user's accessible company documents:
knowledge-base pages, cloud documents, ordinary Sheets, Bitable/Base apps,
Drive files, folders, attachments, and permission checks.

## tower-bridge And tower-ask

`tower-ask` only sends or asks real humans, groups, and external communication
channels. It does not hand work to `o-tower`, `xiao-fei`, or another agent.

When a Tower task needs to send prepared content to `o-tower` so the gateway can
route it through local extensions, use `tower-bridge`:

```text
current task
-> tower-bridge
-> o-tower gateway / Tower task terminal
-> local route to xiao-fei or another operator
-> summarized result back to the current task or user
```

`tower-bridge` is a routing skill. It does not install third-party MCPs and does
not hold Feishu, mail, or knowledge-base credentials by default. It only hands
content to the right execution owner.

## OpenClaw Sketch

Create a dedicated operator workspace:

```bash
openclaw agents add xiao-fei \
  --workspace ~/.openclaw/workspaces/xiao-fei \
  --agent-dir ~/.openclaw/agents/xiao-fei/agent \
  --non-interactive
openclaw agents set-identity --agent xiao-fei --name 小飞
```

Keep allowlists narrow:

```json
{
  "agents": {
    "list": [
      {
        "id": "o-tower",
        "skills": ["tower"],
        "allowedTools": ["tower__*"]
      },
      {
        "id": "xiao-fei",
        "skills": ["feishu"],
        "allowedTools": ["feishu__*"]
      }
    ]
  }
}
```

Place local routes in:

```text
~/.openclaw/workspaces/o-tower/delegation-routes.json
```

See the copyable example:

```text
extensions/tower-agent/examples/openclaw-local-delegation-routes.json
```

Add an instruction to the `o-tower` workspace rules saying that Tower work is
direct, while `feishu.docs`, `feishu.wiki`, `feishu.sheets`, and
`feishu.bitable`, `feishu.drive`, and `feishu.permissions` are delegated to
`xiao-fei`.

## Boundaries

- Do not store app secrets, access tokens, or refresh tokens in docs, prompts,
  or route files.
- Use least privilege and a single token owner for third-party MCPs.
- Write, delete, bulk, permission-changing, and outbound-send actions should
  return a plan first unless the user already confirmed the exact action.
- Tower does not ship Feishu or other third-party integrations by default; it
  ships the delegation pattern.
- User-facing replies should use business names such as document page,
  knowledge-base page, Sheet, Bitable, Drive file, and attachment. Do not expose
  implementation names such as `DocX`, `obj_type`, MCP namespaces, tokens, temp
  file paths, or raw commands.
