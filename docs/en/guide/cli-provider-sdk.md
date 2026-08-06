---
title: CLI Provider Development
description: "@tower-org/ai-sdk Manifest v1, adapters, schemas, and trust boundary"
---

## Publication status

`packages/ai-sdk` defines CLI Provider contract v1 and remains an embedded `private@0.1.0` workspace package. `ai-runtime` and the three official providers are not published independently. Repository and local development may reference source and should bundle runtime SDK imports until a standalone SDK is released.

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
    "compatibility": { "tower": ">=0.3.0 <1.0.0", "node": ">=20" },
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

Tower validates `package.json#tower`, catalog version, Tower/Node range, CLI dependency, permissions, entry, and schema before loading plugin code. V1 allows one provider per package; manifest `id` is the global extension ID and the named export is `towerCliPlugin`.

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

## Catalog contribution and build

The repository layout can move as a unit to a future standalone extension repository:

```text
extensions/
  cli-providers/<provider>/     # provider source, manifest, schema, tests
  catalog/sources/*.json        # reviewable extension/version declarations
  catalog/schema/*.json         # source and generated-index schemas
scripts/build-extension-catalog.ts
```

To contribute a release:

1. Depend only on `@tower-org/ai-sdk` and Host Context, then run the provider's typecheck, tests, and build.
2. Add or update a declaration under `extensions/catalog/sources/`; its ID, publisher, and version must match the package manifest.
3. Run `pnpm extensions:catalog:build -- --base-url https://<authorized-host>/<path>/ --output <directory>`. An authorized publication workflow supplies the base URL; the repository does not assume an organization, domain, or publication location.
4. The generator validates both schemas and packages only the prebuilt `dist` plus config schema. It removes scripts and dependency metadata, normalizes ordering and mtimes, and emits SHA-256, byte size, and `index.v1.json`.
5. Validate through temporary HTTPS/fake fetch fixtures before an authorized workflow uploads anything. Never use real provider credentials during contribution tests.

Tower reads the index URL on the server from `TOWER_EXTENSION_CATALOG_URL`, falling back to the `extensions.catalogUrl` system-config key. Browsers must never submit catalog/artifact URLs or local paths. Runtime HTTPS, response-size, SHA-256, archive-safety, and atomic-install limits still apply.

For local debugging, build the provider and register its absolute directory under Settings -> Extensions -> Developer mode. The `development` registration references source in place and does not copy it into the extension install store.

## Qwen Code sample

`extensions/cli-providers/qwen-code` is a community sample outside the static `ProviderRegistry`. It probes `qwen --version` with range `>=0.18.0 <1.0.0`. Terminal sessions use the interactive CLI; query uses the documented headless `--prompt` and `--output-format json/stream-json` flags, with contract mappings for `--resume`, `--continue`, `--model`, and `--max-session-turns`.

The extension requests only `process:spawn` and `network:provider` and declares only implemented Terminal/query capabilities. Tower does not install `@qwen-code/qwen-code`, configure a Qwen base URL/token, perform login, or modify `~/.qwen`; the user and Qwen CLI own those responsibilities.

## Trust and install boundary

- Normal installation accepts only exact catalog versions and immutable artifacts. The npm runtime remains for legacy registrations and is absent from the normal UI.
- Artifacts require HTTPS, bounded sizes, SHA-256, safe archive paths, and valid static metadata. Lifecycle scripts, dependency trees, native modules, and escaping entries are rejected.
- Plugins start disabled and load on demand after permission confirmation. Permission changes require confirmation. Updates validate in staging before an atomic switch.
- Manifest permissions gate process spawning, provider config, network, MCP, Hooks, and Skills. Plugins remain trusted local Node.js code, not an OS sandbox.

The normative source is `packages/ai-sdk/src/manifest.ts`, `adapter.ts`, `process.ts`, and `config-schema.ts`.
