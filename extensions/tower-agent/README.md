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

For non-Tower work the agent delegates through the gateway's own mechanism —
OpenClaw routes to another agent in `agents.list`; Hermes spawns a subagent via
`delegate_task` with the needed `toolsets`. Any such operator (e.g. a Feishu
one) is configured by the user locally and is never part of the default
install. See `agent/AGENTS.md` and `agent/TOOLS.md` for the delegation rules.

## Optional local operator example: Feishu

Advanced users can extend their own OpenClaw runtime by adding a separate
operator agent, then teaching the Tower profile which requests should be
delegated. This does not change Tower's default install.

Example local OpenClaw setup:

```bash
openclaw plugin add @openclaw/feishu
openclaw agents add xiao-fei \
  --workspace ~/.openclaw/workspaces/xiao-fei \
  --agent-dir ~/.openclaw/agents/xiao-fei/agent \
  --non-interactive
openclaw agents set-identity --agent xiao-fei --name 小飞
```

Constrain skills per agent in `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "list": [
      {
        "id": "o-tower",
        "skills": ["tower"]
      },
      {
        "id": "xiao-fei",
        "skills": ["feishu-doc", "feishu-drive", "feishu-wiki", "feishu-perm"]
      }
    ]
  }
}
```

Then configure Feishu credentials and tool policy in OpenClaw, not in Tower.
For Bitable/Base + wiki/docs, the relevant Feishu tool families are:

```yaml
channels:
  feishu:
    tools:
      doc: true
      drive: true
      wiki: true
      bitable: true
      # or base: true for older configs
      perm: false
```

Add a local route file to the Tower profile workspace, for example:

```text
~/.openclaw/workspaces/o-tower/delegation-routes.json
```

Use `examples/openclaw-local-delegation-routes.json` as the copyable starting
point. In `~/.openclaw/workspaces/o-tower/USER.md`, point the agent at that
file and instruct it to call:

```bash
openclaw agent --agent xiao-fei --json --message-file <task-file>
```

Recommended boundary:

- `o-tower` directly operates Tower only.
- `xiao-fei` owns Feishu execution.
- write/delete/bulk/permission-changing actions return a plan first unless the
  user has explicitly confirmed the exact write.

Restart or reload the OpenClaw gateway after changing agent config.
