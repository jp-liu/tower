# Tower Agent Extension Package

This package contains the Tower assistant profile resources installed into
OpenClaw or Hermes by Tower's Extensions page.

Tower owns the task-management contract, MCP config, skills, and message-routing
rules. The gateway owns model/provider/runtime behavior.

The installer copies these resources into the target gateway profile and links
or copies Tower's bundled gateway-facing skill:

- `tower`

It must not set model, fallback model, provider, or hard-coded global proxy
rules. If the user explicitly configures gateway runtime env (for example proxy
or no-proxy values), Tower may write those user-owned values into the gateway
runtime config.

## Delegation, not integration

The profile is Tower-only by default. It does not bundle Feishu, Notion, Slack,
or any third-party office integration, and it never requires third-party
secrets or skills to install.

For non-Tower work the agent delegates through the gateway's own mechanism:
OpenClaw routes to another agent in `agents.list`; Hermes spawns a subagent via
`delegate_task` with the needed `toolsets`. Any external operator is configured
by the user locally and is never part of the default install. See
`agent/AGENTS.md` and `agent/TOOLS.md` for the delegation rules.

## Extension Guide

Tower's docs can show concrete examples for advanced users who want to add
their own local operators for document spaces, spreadsheets, mail, knowledge
bases, or other office systems. Those examples are documentation only: Tower's
default agent profile stays Tower-only and does not ship concrete third-party
agent names, credentials, route files, or skills.

Recommended boundary for any local extension:

- `o-tower` directly operates Tower only.
- User-local operators own third-party execution.
- Capability routes for external systems point to user-local operators; Tower
  capabilities such as `tower.task`, `tower.project`, and `tower.note` stay on
  `o-tower`.
- User-facing replies should use business names such as "文档页面", "知识库页面",
  "表格", "多维表格", "云盘文件", or "附件"; do not expose implementation names,
  MCP namespaces, tokens, or temp file paths.
- write/delete/bulk/permission-changing actions return a plan first unless the
  user has explicitly confirmed the exact write.

Restart or reload the gateway after changing agent config.
