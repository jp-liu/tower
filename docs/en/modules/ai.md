---
title: AI
description: AI Tools 0.3 connections, capability slots, CLI plugins, and API runtime
---

# AI Module

**Slug:** `ai`

## 0.3.0 status

AI Tools now uses a connection-and-slot model instead of a Claude-only call path. The top half of Settings manages CLI/API connections; the bottom half assigns ordered targets to Terminal, Summary, Dreaming, Analysis, and Assistant. See [AI Tools 0.3](/en/guide/ai-tools) for user workflows and [CLI Provider development](/en/guide/cli-provider-sdk) for the contract.

| Slot | Purpose | Connection types |
|---|---|---|
| Terminal | Interactive task terminal | CLI only |
| Summary | Short execution summary | CLI / API |
| Dreaming | Insights and knowledge capture | CLI / API |
| Analysis | Project analysis | CLI / API |
| Assistant | Tower-owned multi-turn chat | CLI / API |

Built-in CLI providers are Claude Code, Codex CLI, and Gemini CLI. The API runtime supports OpenAI, OpenAI Compatible, Anthropic, and Google. Targets use a stable `connectionId + modelId`, not a provider name as an instance identifier.

## Execution semantics

- A slot uses only its explicit primary and ordered fallback targets.
- Key or target fallback is allowed only before the first content, tool call, or side effect. Once activity starts, the target is locked.
- Terminal may fall back before creating a new session. The successful connection/model snapshot is stored on `TaskExecution` and reused for resume.
- API keys round-robin only among enabled, healthy keys. `401`, `403`, and `429` may rotate a key only before activity.
- Attempt telemetry stores target, model, duration, and redacted error code, never prompts, keys, or sensitive header/query values.

## Boundaries

| Layer | Location | Responsibility |
|---|---|---|
| Public CLI contract | `packages/ai-sdk` | Manifest v1, adapters, process specs, events, and config schema types |
| Private host runtime | `packages/ai-runtime` | Controlled processes, API adapters, fallback, plugin validation, models.dev snapshot |
| Built-in providers | `packages/ai-provider-*` | Claude/Codex/Gemini arguments, parsing, and MCP/Hooks/Skills integration |
| Application services | `src/lib/ai` | Connections, slot resolution, Assistant sessions/tools, and auditing |

All workspace packages remain `private@0.1.0`. That is an internal contract version independent of the Tower app's `0.3.0`; this release creates no external organization and publishes no SDK or provider package.

## Security

- Each CLI owns its login, token, and base URL. Tower handles discovery, Hello probes, process launch, and integration status.
- API keys are plaintext in local SQLite. The UI masks them by default but permits reveal, copy, and edit; logs and errors are redacted.
- Third-party CLI plugins are trusted local Node.js code, not an OS sandbox. Tower validates exact versions, integrity, static manifests/schemas, and declared permissions before enablement.
- Adapters return structured process specs. The host disables shell execution by default and owns deadlines, cancellation, and process-tree cleanup.

Public npm publication, an external organization/scope, arbitrary API adapter plugins, and OS-level plugin sandboxing remain future work.
