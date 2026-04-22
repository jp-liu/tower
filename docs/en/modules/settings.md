---
title: Settings
description: System configuration including general settings, AI tools, and CLI profiles
---

# Settings Module

**Slug:** `settings`

## Overview

System settings are organized into several sections that control Tower's behavior:

- **General**: Theme selection (dark, light, or system), language toggle (Chinese/English), and default terminal application.
- **Terminal**: WebSocket port for terminal connections and idle timeout duration.
- **System**: Upload size limits, maximum concurrent task executions, Git operation timeout, and search tuning parameters.
- **CLI Profile**: Configure the AI CLI command (`claude` or `claude-code`), base arguments, and environment variables. These settings affect every task execution across the platform. Only one profile can be set as the default at a time.
- **Prompt Templates**: Create and manage custom AI prompt templates that can be scoped to a specific workspace. When launching a task execution, you can select which prompt template to use.
- **Agent Config**: Additional prompt text and settings per AI agent type, with a unique constraint on agent + config name.
- **Git Path Mapping**: Map Git host/owner combinations to local filesystem paths for automatic resolution of Git URLs to local directories.

## Details

- **Theme**: Follows system preference by default. Switching takes effect immediately without page reload.
- **Language**: Switching between Chinese and English applies to all UI text instantly.
- **CLI Profile security**: The `command` field only accepts `claude` or `claude-code`. The `baseArgs` field blocks shell metacharacters (`;&|$()`), and `envVars` blocks dangerous keys like `PATH`, `LD_PRELOAD`, and `NODE_OPTIONS`.
- **Prompt templates**: Templates support both global scope (available everywhere) and workspace scope (only available within a specific workspace). Each task can select its own template before execution.

## File Reference

### Pages

| Route | Description |
|-------|-------------|
| `/settings` | Settings main page |

### Components (`src/components/settings/`)

| Component | Description |
|-----------|-------------|
| `general-config.tsx` | General configuration |
| `system-config.tsx` | System configuration |
| `ai-tools-config.tsx` | AI tools configuration |
| `cli-profile-config.tsx` | CLI Profile management |

### Server Actions

| File | Description |
|------|-------------|
| `config-actions.ts` | System config read/write |
| `agent-config-actions.ts` | Agent config management |
| `cli-profile-actions.ts` | CLI Profile CRUD |

### Data Models

**CliProfile**: Controls the CLI command and arguments used by PTY sessions
- `command`: CLI command (default `claude`)
- `baseArgs`: JSON string array
- `envVars`: JSON object
- `isDefault`: Only one default profile allowed

**AgentConfig**: Agent-specific configuration
- Unique constraint: `(agent, configName)`
