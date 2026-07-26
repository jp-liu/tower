---
title: 0.3.0 Release Notes
description: AI Tools 0.3 features, migration, security, and known limitations
---

> Status: the repository is prepared for a local 0.3.0 artifact. No npm publish, tag, or GitHub Release has been created.

## User-visible features

- AI Tools uses connections above and five slots (Terminal, Summary, Dreaming, Analysis, Assistant) below.
- Built-in Claude Code, Codex CLI, and Gemini CLI discovery, Hello, models, and MCP/Hooks/Skills status. CLIs own their login and network credentials.
- OpenAI, OpenAI Compatible, Anthropic, and Google API connections with custom base URL/headers/query, per-key health and round-robin, discovery plus manual models.
- Explicit ordered fallback stops after first activity; Terminal pins connection/model.
- Tower-owned multi-turn Assistant sessions, on-demand legacy Claude import, attachments, Tower tools, SSE, and cancellation.
- Extension-center CLI provider catalog browsing, search, install/update, permission review, disable/uninstall, and a separate local developer-directory path.
- A Qwen Code community provider sample outside the built-in registry; users install and authenticate the Qwen Code CLI themselves.
- Production CLI defaults to `127.0.0.1`; explicit `--host` remains available.

## Migration and compatibility

Startup syncs Prisma schema, then runs ledger migrations `0009-api-connections` through `0013-assistant-sessions`; older 0.2 databases also receive missing `0001` through `0008`. Legacy `CliProfile`, `AgentConfig`, and Claude transcripts remain available through compatibility reads, target mapping, and on-demand copy import. See [Upgrading to 0.3.0](/en/guide/upgrade-0.3).

## Security model

- Loopback-only by default; explicit remote hosts opt into a broader trust boundary.
- API keys are plaintext in local SQLite, masked by default, revealable/copyable/editable, included in full DB backups, and redacted from logs/errors.
- Plugins are integrity-, manifest-, schema-, permission-, and process-checked trusted local Node.js code, not an OS sandbox.
- Runtime exposes neither Prisma, other connections, nor API keys to plugins and does not accept provider shell command strings.

## Known limitations

- `@tower/ai-sdk`, private Runtime, and official providers remain `private@0.1.0` workspace packages. No organization or standalone npm package was published.
- API adapter plugins are not open; Terminal remains CLI-only.
- Assistant temporary attachment cache and CLI plugin registry/install directories are outside current full archives; plugins require reinstall/confirmation after restore.
- 0.3 databases are not promised write-compatible with 0.2; downgrade requires a pre-upgrade backup.
- Final isolated standalone install/migration smoke and cross-module acceptance remain required before external publication.
