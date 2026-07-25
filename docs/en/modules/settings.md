---
title: Settings
description: Global settings, AI Tools, CLI plugins, and data management
---

# Settings Module

**Slug:** `settings`

`/settings` manages theme/language, Terminal, system behavior, prompts, Git paths, extensions, backups, and AI Tools. AI Tools has two clear layers: **connections above, five capability slots below**.

## AI Tools connections

- Claude Code, Codex CLI, and Gemini CLI: command/version discovery, minimal Hello test, models, and MCP/Hooks/Skills status. Each CLI owns login, token, and base URL.
- OpenAI, OpenAI Compatible, Anthropic, and Google API: editable base URL, custom headers/query parameters, per-key health checks and round-robin, discovered plus manual models.
- Tower trims base URLs and removes a trailing slash but never appends `/v1`.
- API keys are plaintext in local SQLite, masked by default, and available to reveal, copy, or edit. Normal logs and errors redact them.
- Third-party CLI plugins install from an exact npm version or local development directory. Permission review precedes enablement; configuration, disable, re-enable, and uninstall are supported.

## Capability slots

Terminal, Summary, Dreaming, Analysis, and Assistant each store a primary and ordered fallback targets. Fallback stops after first activity. Terminal additionally pins connection/model on the execution record.

## Compatibility

Legacy `CliProfile` and `AgentConfig` rows remain. `CliProfile` still supplies compatible command, arguments, and environment settings for built-in CLIs, while AI Tools connections/slots are the 0.3 configuration surface. See [AI Tools 0.3](/en/guide/ai-tools).

Other sections cover Terminal WebSocket settings, system limits, prompts, Git paths, Tower Agent extensions, and backup/restore. See [Upgrading to 0.3.0](/en/guide/upgrade-0.3) for credential and attachment scope.
