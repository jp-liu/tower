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

Only the `tower` skill is installed into gateway profiles. `tower-ask` and
`tower-goal` are task-terminal skills and remain available through Tower's
normal task-agent installation path, not through the OpenClaw/Hermes bridge
profile.

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
