# Tower Agent Extension Design

## Goal

Let a user install Tower from npm, open Settings -> Extensions, and install a
Tower assistant profile into OpenClaw or Hermes without cloning the Tower repo or
copying files by hand.

The extension makes OpenClaw/Hermes able to:

- use Tower MCP tools;
- load the Tower gateway-facing skill (`tower`);
- preserve image/file paths as Tower task references;
- route outbound work/unattended messages through the configured gateway;
- relay inbound replies carrying `[[tower:task=...]]` back to Tower.

## Non-goals

Tower does not own gateway internals:

- no model/fallback/provider changes;
- no global proxy decision;
- no gateway process restart;
- no downstream app credential management beyond documenting where to configure
  it in the gateway;
- no custom agent package format when a gateway already has a profile/skill
  format.

## Package Location

The npm package includes:

```text
extensions/tower-agent/
├── manifest.json
├── README.md
└── agent/
    ├── SOUL.md
    ├── AGENTS.md
    └── TOOLS.md
```

This stays inside the main Tower repo for now so the profile contract and Tower
MCP version move together. It can later become a separate package once the
format stabilizes.

## Install Flow

1. User installs Tower:

   ```bash
   npm install -g tower-studio
   tower
   ```

2. User opens Settings -> Extensions and installs:

   - Tower Agent (OpenClaw), or
   - Tower Agent (Hermes).

3. Tower runs the internal installer:

   ```ts
   installTowerAgentExtension({ gateway: "openclaw" })
   installTowerAgentExtension({ gateway: "hermes" })
   ```

4. The installer writes only profile-level files and Tower integration config.
   It does not launch or restart gateway services.

## OpenClaw Integration

OpenClaw uses agent/workspace files. The installer creates or refreshes:

```text
~/.openclaw/workspaces/o-tower/
├── SOUL.md
├── AGENTS.md
├── TOOLS.md
├── mcp.json
├── gateway.env.example
├── .tower-agent.json
└── skills/
    └── tower/
```

It also upserts an entry into `~/.openclaw/openclaw.json` under `agents.list`.
The entry contains `id`, `name`, `workspace`, `agentDir`, and display identity.
It intentionally does not write `model`, `fallbacks`, or provider data.

Only the `tower` skill is installed into gateway profiles. `tower-ask`,
`tower-goal`, and `tower-bridge` are task-terminal skills and remain available
through Tower's normal task-agent installation path, not through the
OpenClaw/Hermes bridge profile.

## Hermes Integration

Hermes already has a profile adapter in Tower. The installer:

1. writes the Tower agent files into `~/.hermes/profiles/h-tower/`;
2. reuses `HermesCliAdapter` through `installHermesGateway(profile)` to install
   Tower MCP and the `tower` skill using Hermes' existing config paths.

This avoids inventing a second Hermes config writer.

## Runtime Environment

Gateway runtime env belongs to the user's machine or gateway launcher.

Tower may write a `gateway.env.example` next to the profile so users have a
place to record local choices, but Tower does not inject hard-coded values such
as `.iflytek.com` into `NO_PROXY`.

Different organizations may need opposite proxy behavior:

- private Feishu/OpenClaw domains may need `NO_PROXY`;
- external hosted gateways may require `HTTPS_PROXY`.

The extension installer must stay neutral.

## Delegation (Tower-only by default)

The profile owns Tower capability and nothing else. When a request needs a
non-Tower system (spreadsheet, wiki, cloud doc, office IM), the agent does not
pretend to own it — it delegates through the gateway's existing mechanism and
summarizes the result, or says no external agent is configured.

The two gateways delegate differently, so Tower does not invent a delegation
runtime — it only teaches the boundary in the shared agent files and lets each
gateway's native mechanism carry it:

- **OpenClaw** is a multi-agent gateway. Delegation routes to another agent in
  `agents.list`. Capability isolation is per **agent workspace**.
- **Hermes** exposes a first-class `delegate_task` tool (plus a `delegation`
  toolset and `delegation:` config block). Delegation spawns an isolated
  subagent; capability isolation is per **toolset** passed to `delegate_task`.

Because both gateways already provide delegation, Tower ships no
`delegation.json` format and no `delegateToAgent()` runtime. The rules live in
`agent/SOUL.md`, `agent/AGENTS.md`, and `agent/TOOLS.md` at the capability-goal
level, so one shared prompt works on both gateways.

Default purity holds on both sides without extra install code: the OpenClaw
workspace installs only the `tower` skill, and the Hermes install writes only
Tower MCP + the `tower` skill (no Feishu skill, secret, or enabled toolset). A
user who wants Feishu configures their own operator agent (OpenClaw) or enables
Feishu toolsets on a delegated subagent (Hermes) locally — never by default.

### OpenClaw Local Operator Routing

For OpenClaw, the recommended extension path is an optional local operator
agent. Tower does not install this operator; the user creates it in their own
OpenClaw runtime and records a simple route map in the Tower profile workspace.

Example Feishu operator:

```bash
openclaw plugin add @openclaw/feishu
openclaw agents add xiao-fei \
  --workspace ~/.openclaw/workspaces/xiao-fei \
  --agent-dir ~/.openclaw/agents/xiao-fei/agent \
  --non-interactive
openclaw agents set-identity --agent xiao-fei --name 小飞
```

Example agent skill allowlists:

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
        "skills": ["feishu"],
        "allowedTools": ["feishu__*"]
      }
    ]
  }
}
```

Example Feishu tool policy, owned by OpenClaw:

```yaml
channels:
  feishu:
    tools:
      doc: true
      drive: true
      wiki: true
      sheets: true
      bitable: true
      perm: false
```

Example Tower-profile route map:

```json
{
  "schemaVersion": 1,
  "sourceAgent": "o-tower",
  "defaultPolicy": {
    "directCapabilities": ["tower"],
    "delegateExternalCapabilities": true,
    "noDefaultThirdPartyIntegration": true
  },
  "routes": [
    {
      "id": "feishu-bitable",
      "match": ["飞书表格", "飞书多维表格", "Bitable", "Base"],
      "agent": "xiao-fei",
      "delegateCommand": "openclaw agent --agent xiao-fei --json --message-file <task-file>",
      "requiresConfirmationForWrite": true
    },
    {
      "id": "feishu-knowledge-base",
      "match": ["飞书知识库", "飞书 wiki", "飞书文档", "飞书云文档"],
      "agent": "xiao-fei",
      "delegateCommand": "openclaw agent --agent xiao-fei --json --message-file <task-file>",
      "requiresConfirmationForWrite": true
    }
  ]
}
```

This file is intentionally user-local, for example:

```text
~/.openclaw/workspaces/o-tower/delegation-routes.json
```

The Tower profile can reference it from `USER.md`. `o-tower` remains the
conversation owner and Tower reporter; `xiao-fei` owns Feishu execution and
returns structured results.

After changing OpenClaw agent config, restart or reload the OpenClaw gateway so
the allowlists and new operator are applied to live sessions.

## Relationship To Notification Settings

Extensions install gateway capability. Notification settings choose the active
send route:

- installed OpenClaw/Hermes extension -> gateway can appear as a supported route;
- notification target -> `gateway + downstream + optional profile + optional
  destination`.

This keeps install/config separate from day-to-day routing.

## Future Work

- Add per-extension settings UI for profile name, display name, and env.
- Add an explicit "reinstall profile" action.
- Hide uninstalled gateways from notification route creation.
- Add automated UI smoke tests once production can be restarted safely.
