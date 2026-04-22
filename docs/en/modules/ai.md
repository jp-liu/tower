---
title: AI
description: AI capability layer covering Claude Agent SDK, CLI adapter, assistant chat, task execution, and summaries
---

# AI Module

**Slug:** `ai`

## Overview

The AI capability layer manages all AI-powered features in Tower. There are 5 distinct capabilities, each serving a different purpose:

1. **Assistant chat** — Multi-turn streaming conversation via the Claude Agent SDK. The assistant acts as a task management operator with access to Tower's MCP tools.
2. **Mini summary** — Generates a short (~50 character) summary when a task execution stops, used for quick reference in the UI.
3. **Dreaming** — Produces structured insight JSON when a task execution completes, capturing what was accomplished, patterns discovered, and learnings. These are auto-saved as notes.
4. **Project analysis** — Analyzes a project's local directory structure on import, generating a structured description covering tech stack, architecture, and key directories.
5. **Task execution** — Spawns a PTY terminal running Claude CLI in an isolated environment for interactive AI-driven development.

Different capabilities can use different models. Lightweight tasks like mini summaries use Haiku for cost efficiency, while deeper analysis like Dreaming uses Sonnet for higher quality output.

## Details

- **Model routing**: Each capability specifies a suggested model. `generateSummaryFromLog` uses Haiku 4.5 for fast, cheap summaries. `generateDreamingInsight` and `analyzeProjectDirectory` use Sonnet 4.6 for deeper reasoning. Task execution and assistant chat use the system's configured default model.
- **CLI adapter**: Currently hardcoded for Claude Code. The interface (`spawn`, `resume`, `continue`, `getSessionId`, `buildEnvOverrides`) is designed for future abstraction to support multiple CLI providers.
- **Execution summaries**: When a task execution ends, Tower automatically extracts the terminal output log and generates both a mini summary and a Dreaming insight, attaching them to the execution record and saving the insight as a project note.

## AI Capability Entry Points

| Capability | File | Invocation Method | Suggested Model |
|------------|------|-------------------|-----------------|
| Assistant chat | `api/internal/assistant/chat/route.ts` | Agent SDK `query()` | Current default |
| Short summary | `lib/claude-session.ts` -> `generateSummaryFromLog` | Agent SDK `aiQuery()` | Haiku 4.5 |
| Long summary (Dreaming) | `lib/claude-session.ts` -> `generateDreamingInsight` | Agent SDK `aiQuery()` | Sonnet 4.6 |
| Project analysis | `actions/project-actions.ts` -> `analyzeProjectDirectory` | Agent SDK `aiQuery()` | Sonnet 4.6 |
| Task execution | `actions/agent-actions.ts` -> `startPtyExecution` | PTY spawn CLI | Current default |

## File Reference

### Core Library

| File | Description |
|------|-------------|
| `lib/claude-session.ts` | Unified AI entry: `aiQuery()`, `generateSummaryFromLog()`, `generateDreamingInsight()` |
| `lib/assistant-sessions.ts` | Assistant session management (localStorage registry) |
| `lib/assistant-constants.ts` | `ASSISTANT_SESSION_KEY` and other constants |
| `lib/assistant-message-converter.ts` | SDK message to UI message format conversion |
| `lib/build-multimodal-prompt.ts` | Multimodal prompt construction (text + images) |
| `lib/execution-summary.ts` | Post-execution summary and Dreaming insight generation |
| `lib/cli-test.ts` | CLI adapter environment detection |

### Server Actions

| File | Function | Description |
|------|----------|-------------|
| `actions/agent-actions.ts` | `startPtyExecution` | Start Claude CLI PTY |
| `actions/agent-actions.ts` | `resumePtyExecution` | Resume session |
| `actions/agent-actions.ts` | `continueLatestPtyExecution` | Continue latest session |
| `actions/cli-profile-actions.ts` | `getDefaultCliProfile` | Get active CLI profile |
| `actions/prompt-actions.ts` | `getPrompts` / `createPrompt` | Prompt template management |
| `actions/project-actions.ts` | `analyzeProjectDirectory` | AI project analysis |

### API Routes

| Route | Description |
|-------|-------------|
| `/api/internal/assistant/chat` | Assistant chat SSE streaming |
| `/api/internal/assistant/sessions` | Session message retrieval |
| `/api/internal/assistant/images` | Image serving |
| `/api/adapters/test` | CLI adapter connection test |

### Data Models

| Model | Description |
|-------|-------------|
| `CliProfile` | CLI command, arguments, and environment variable config. `command` only allows `claude`/`claude-code` |
| `AgentConfig` | Agent-specific config with unique constraint `(agent, configName)` |
| `AgentPrompt` | Prompt templates, supporting global and workspace-level scopes |
| `TaskExecution` | Execution records, including `sessionId`, `summary`, `gitLog`, `insightNoteId` |

### Components

| Component | Description |
|-----------|-------------|
| `settings/cli-profile-config.tsx` | CLI Profile configuration UI |
| `settings/cli-adapter-tester.tsx` | CLI connection test UI |
| `settings/prompts-config.tsx` | Prompt template management UI |
| `settings/ai-tools-config.tsx` | Agent configuration UI |

## CLI Adapter Interface (TODO)

Currently hardcoded for Claude Code. Will be abstracted when integrating a second CLI:

```
spawn(cwd, args, env)        -- Start CLI process (PTY)
resume(sessionId)            -- Resume session
continue()                   -- Continue latest session
getSessionId()               -- Get session ID
getHooks() / installHooks()  -- Hook configuration and registration
buildEnvOverrides(taskId)    -- Environment variable injection
```

See [README.md TODO](../../README.md#todo) for the detailed interface list.

## Security Constraints

- `CliProfile.command` is restricted to the whitelist: `claude`, `claude-code`
- `baseArgs` prohibits shell metacharacters `;&|$()`
- `envVars` prohibits dangerous keys: `PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, etc.
- Environment variables are injected via `envOverrides`; modifying `process.env` is forbidden
