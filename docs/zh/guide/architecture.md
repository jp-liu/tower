---
title: 架构概览
description: Tower 系统的分层架构设计
---

## 分层架构

Tower 采用分层架构设计，从上到下分为：

- **UI 层** — Next.js App Router 页面和 React 组件，使用 shadcn 组件库和 TailwindCSS
- **状态管理层** — Zustand store 管理客户端状态（看板、执行等）
- **Server Actions 层** — Next.js Server Actions 处理业务逻辑和数据操作
- **数据访问层** — Prisma ORM 操作 SQLite 数据库
- **PTY 层** — node-pty 管理终端会话，WebSocket 实时传输 I/O
- **MCP 层** — MCP Server 通过 stdio 向外部 AI Agent 暴露工具

## 核心数据流

```
Workspace → Project → Task → TaskExecution
                                    ↓
                              PTY Session (Claude CLI)
                                    ↓
                              WebSocket → xterm.js
```

## 架构图

详细架构图请参见 [架构图](./diagrams) 页面，包括系统架构、数据模型、任务生命周期、AI 架构和模块依赖关系图。
