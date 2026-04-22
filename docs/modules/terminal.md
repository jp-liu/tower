---
title: Terminal 模块
description: PTY 终端系统，为每个 Task 提供独立的 Claude CLI 终端会话
---

**Slug:** `terminal`

## 功能介绍

每个任务有独立的终端会话，通过 xterm.js 在浏览器中渲染完整的终端界面。

主要能力：

- **实时终端**：通过 WebSocket 实时传输终端 I/O，支持完整的 ANSI 渲染（颜色、进度条、光标移动）
- **键盘交互**：支持完整的键盘输入，可以直接在终端中和 Claude CLI 对话、回答问题、确认操作
- **断连保活**：断开连接后会话不会立即销毁 — 运行中的会话保活 2 小时，已退出的会话保活 5 分钟。重连后不丢失任何输出
- **多客户端查看**：同一个终端会话支持多个客户端同时查看，任务详情页和 Missions 面板可以同时显示同一个终端
- **会话恢复**：支持通过 sessionId 恢复之前的 Claude CLI 会话，继续上一次的对话上下文

## 详细说明

### 架构

```
Client (xterm.js) ←→ WebSocket ←→ ws-server.ts ←→ PTY Session (node-pty)
                                                         ↕
                                                    session-store.ts
```

### 生命周期

- 每个 taskId 只能有一个活跃 PTY 会话
- 并发上限由 `system.maxConcurrentExecutions` 配置（默认 20）
- SIGTERM 时自动清理所有会话
- `AI_MANAGER_TASK_ID` 和 `CALLBACK_URL` 注入到 PTY 环境变量
- 禁止修改 `process.env`，使用 `envOverrides`

## 文件清单

### 核心库 (`src/lib/pty/`)

| 文件 | 说明 |
|------|------|
| `pty-session.ts` | PTY 会话管理（node-pty 封装） |
| `session-store.ts` | 内存中 PTY 会话存储，按 taskId 索引 |
| `ws-server.ts` | WebSocket 服务器，端口由 `terminal.wsPort` 配置 |

### API Routes

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/internal/terminal/[taskId]/start` | POST | 启动 PTY 会话 |
| `/api/internal/terminal/[taskId]/buffer` | GET | 获取终端输出缓冲 |
| `/api/internal/terminal/[taskId]/input` | POST | 发送输入到终端 |

### Server Actions (`src/actions/agent-actions.ts`)

| 函数 | 说明 |
|------|------|
| `startPtyExecution(taskId, prompt)` | 启动 Claude CLI PTY |
| `resumePtyExecution(taskId, sessionId)` | 恢复会话 |
| `stopPtyExecution(taskId)` | 终止会话 |

### 组件

- `src/components/task/task-terminal.tsx` — xterm.js 终端 UI

### MCP Tools (`src/mcp/tools/terminal-tools.ts`)

- `get_task_terminal_output` / `send_task_terminal_input` / `get_task_execution_status`
