---
title: Terminal
description: PTY terminals with explicit fallback and pinned session targets
---

# Terminal Module

**Slug:** `terminal`

Each task gets an interactive xterm.js, WebSocket, and node-pty terminal. The Terminal slot can order Claude Code, Codex CLI, Gemini CLI, or enabled third-party CLI providers. API connections cannot drive Terminal.

## Target binding

- Before a new session starts, a missing CLI, failed probe, or launch failure may advance to the next explicit fallback.
- After the first terminal activity, Tower never switches target. The successful connection, provider, model, and command details are snapshotted on `TaskExecution`.
- Resume/Continue reuses the original connection/model. A disabled, uninstalled, or damaged plugin produces an explicit error instead of silently changing provider.
- Legacy `CliProfile` rows remain a compatibility source for built-in CLI command/arguments; AI Tools CLI connections are the current configuration surface.

## Runtime

- One active PTY per `taskId`; `system.maxConcurrentExecutions` controls concurrency.
- Disconnected sessions remain for two hours while running and five minutes after exit. Task pages and Missions can observe the same session.
- Tower injects `TOWER_TASK_ID`, `TOWER_TASK_TITLE`, `TOWER_API_URL`, and optional `CALLBACK_URL`; additional variables use controlled env patches.
- Production `tower` only accepts `127.0.0.1`, `localhost`, or `::1`, and rejects wildcard and LAN addresses. HTTP, WebSocket, origin checks, and internal routes share that production result. Dev and preview settings are unchanged.

Key code lives in `src/actions/agent-actions.ts`, `src/lib/ai/terminal-target.ts`, `src/lib/pty/`, and `/api/internal/terminal/[taskId]/*`.
