---
title: AI Tools 0.3
description: Connections, capability slots, Assistant, and CLI plugins
---

## Mental model

Open Settings -> AI Tools. Create **connections** in the upper section, then assign them to **Terminal, Summary, Dreaming, Analysis, and Assistant** below. Connections answer “which AI services can Tower reach?” Slots answer “which connection and model does this feature use, in what order?” One connection may serve multiple slots.

## CLI connections

Tower includes Claude Code, Codex CLI, and Gemini CLI. Each card reports command discovery path, version, Hello probe, models, and MCP/Hooks/Skills support and installation status. A connection may be not found, found but not runnable, unauthenticated/disconnected, or connected.

Each CLI owns account login, token, proxy, and base URL. Configure those through the CLI itself. Tower's advanced environment variables are a compatibility path, not a replacement for CLI login. A Hello probe must receive a minimal model reply; `--version` alone is not connected.

## API connections

Tower supports OpenAI, OpenAI Compatible, Anthropic, and Google. You may create multiple named instances of the same protocol.

- Supply a complete `http://` or `https://` base URL. Tower trims it and removes a trailing slash but **never appends `/v1`**.
- Add and toggle custom headers/query parameters. Transport headers are blocked and sensitive names are masked.
- A connection may hold multiple keys. Each key is health-tested with the default model. Runtime round-robin uses only enabled, successful keys.
- Before any content/tool side effect, `401`, `403`, or `429` may rotate to another healthy key. Rotation stops after streaming begins.
- Models combine discovery and manual entries. Refresh preserves manual models; referenced models removed upstream become unavailable rather than disappearing.

API keys are plaintext in local SQLite. They are masked by default but the local user can reveal, copy, and edit them. Keys and sensitive headers/query values enter a full database backup; normal logs, errors, task messages, and test reports redact them.

## Five capability slots

Each slot stores a primary and user-ordered fallbacks as stable `connection + model` targets. Tower never picks an undeclared “first available provider.”

- Terminal: CLI only. Fallback is allowed before a new session starts; the successful connection/model is pinned for Resume.
- Summary: falls back to deterministic Git/commit text if all targets fail.
- Dreaming: skips on total failure and can be retried later.
- Analysis: preserves the existing project description.
- Assistant: may fall back before the turn's first stream/tool activity, then locks.

Cancellation, safety refusal, invalid configuration, and tool execution errors do not trigger cross-connection fallback.

## Assistant

Tower-owned multi-turn sessions support workspace/project/version bindings, image/text attachments, SSE, Tower tool cards, and cancellation. Legacy Claude Assistant sessions remain visible and are copied on demand when first opened. Tower does not automatically delete or rewrite the original transcript. Imported history can continue with another configured provider.

## Third-party CLI plugins

Install an exact npm package version or select an absolute local development directory. Tower verifies integrity, manifest, entry, schema, and permissions without running npm install scripts. Plugins start disabled and load only after permission confirmation. You can then edit command/arguments/environment/schema settings, disable, re-enable, or uninstall.

Plugins are trusted local Node.js code, not an OS sandbox. Install only packages you trust.

## Diagnostics

| State/error | Action |
|---|---|
| CLI missing | Install it, fix command override, or select an absolute path, then detect again |
| CLI not logged in | Complete login/token/base URL in the CLI and rerun Hello |
| MCP disconnected | Inspect and reinstall/repair MCP; CLI installation alone is insufficient |
| API `401`/`403` | Check key, permissions, authorization override, protocol, and base URL |
| API `429` | Check quota/rate limit; healthy keys can rotate only before activity |
| `model unavailable` | Refresh or add the exact model ID manually, then update the slot |
| Plugin damaged | Check integrity/local path, reinstall, or recover the registry |
| Permission required | Review and explicitly confirm the declared permissions |
| `slot unconfigured` | Add at least one enabled, connected target to the slot |

See [Upgrading to 0.3.0](/en/guide/upgrade-0.3) for migration and backup boundaries.
