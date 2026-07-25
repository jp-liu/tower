---
title: CLI Provider Development
description: "@tower/ai-sdk Manifest v1, adapters, schemas, and trust boundary"
---

## Publication status

`packages/ai-sdk` defines the public CLI Provider v1 contract, but remains a `private@0.1.0` workspace package in Tower 0.3.0. `ai-runtime` and the three official providers are also private. This release creates no GitHub organization/npm scope and publishes no standalone package. Repository/local development may reference source and should bundle runtime SDK imports until a later public release.

## Minimal package

```json
{
  "name": "@example/tower-provider-acme",
  "version": "1.0.0",
  "type": "module",
  "exports": { "./tower-cli-provider": "./dist/provider.js" },
  "files": ["dist", "config.schema.json"],
  "tower": {
    "manifestVersion": 1,
    "apiVersion": "1.0",
    "kind": "cli-provider",
    "display": { "name": "Acme CLI", "description": "Acme CLI for Tower" },
    "command": {
      "default": "acme",
      "aliases": ["acme-cli"],
      "knownPaths": { "darwin": ["~/.local/bin/acme"], "linux": ["~/.local/bin/acme"] },
      "versionArgs": ["--version"]
    },
    "compatibility": { "tower": ">=0.3.0 <0.4.0", "node": ">=20" },
    "capabilities": {
      "sessions": { "fresh": true, "resume": true },
      "query": { "generate": true, "stream": true },
      "models": true,
      "integrations": { "mcp": true, "hooks": false, "skills": true }
    },
    "permissions": ["process:spawn", "network:provider", "integration:mcp", "integration:skills"],
    "configSchema": "./config.schema.json"
  }
}
```

Tower validates `package.json#tower`, exact npm version, Tower/Node range, permissions, entry, and schema before loading plugin code. V1 allows one provider per package; the package name is the global ID and the named export is `towerCliPlugin`.

## Adapter contract

Use `defineCliPlugin()` and implement `CliAdapter`, optionally through `BaseCliAdapter`. `buildSessionProcess()` returns structured `command`, `args`, `cwd`, `envPatch`, and optional `initialInput`, never a shell command string. The host owns command discovery, PTY/process lifecycle, timeout, cancellation, and cleanup.

`generate()` returns a canonical result. `stream()` emits `text`, `reasoning`, `tool-call`, `tool-result`, `usage`, `session`, `finish`, and `error`; `BaseCliAdapter` can derive a stream from generate, while `collectCliQueryStream()` aggregates a provider-native stream. `models()` returns IDs and display metadata. MCP, Hooks, and Skills are separate optional `inspect/install/uninstall` interfaces.

Adapters use Host Context for controlled processes, plugin storage, platform data, redacted logging, and AbortSignal. They must not mutate `process.env` or access Prisma, other connections, or API keys.

## JSON Schema and `x-tower`

Configuration uses JSON Schema 2020-12. `x-tower` supports `control`, `order`, `group`, `advanced`, and `sensitive`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "profile": {
      "type": "string",
      "default": "default",
      "x-tower": { "control": "text", "order": 1, "group": "CLI" }
    },
    "accessToken": {
      "type": "string",
      "x-tower": { "control": "text", "order": 2, "group": "Advanced", "advanced": true, "sensitive": true }
    }
  }
}
```

The host owns connection name, enabled state, command override, base args, and advanced environment. Plugin schemas describe only `settings`; secrets must be marked sensitive and must not enter logs, errors, manifests, or registry summaries.

## Trust and install boundary

- npm installs require exact SemVer, verified registry integrity, safe archive paths, and valid static metadata. Install scripts are disabled; native modules and escaping entries are rejected.
- Plugins start disabled and load on demand after permission confirmation. Permission changes require confirmation. Updates validate in staging before an atomic switch.
- Manifest permissions gate process spawning, provider config, network, MCP, Hooks, and Skills. Plugins remain trusted local Node.js code, not an OS sandbox.

The normative source is `packages/ai-sdk/src/manifest.ts`, `adapter.ts`, `process.ts`, and `config-schema.ts`.
