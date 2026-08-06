---
title: Terminal 模块
description: 支持显式连接回退和固定会话目标的 PTY 终端
---

**Slug:** `terminal`

每个任务通过 xterm.js、WebSocket 和 node-pty 获得独立交互终端。Terminal 插槽可按顺序配置 Claude Code、Codex CLI、Gemini CLI 或已启用的第三方 CLI Provider；API 连接不能驱动终端。

## 目标绑定

- 新会话启动前，CLI 未安装、探测失败或进程启动失败时，才尝试下一个显式备用目标。
- 第一项终端活动发生后不切换目标。成功目标的 `connectionId`、Provider、model 和命令信息会快照到 `TaskExecution`。
- Resume/Continue 固定恢复原 connection/model；原插件被禁用、卸载或损坏时明确失败，不静默换到另一个 Provider。
- 旧 `CliProfile` 继续作为内置 CLI 的兼容命令/参数来源；新配置以 AI Tools 的 CLI connection 为准。

## 运行时

- 每个 `taskId` 只有一个活跃 PTY；并发上限由 `system.maxConcurrentExecutions` 控制。
- 运行中断连保活 2 小时，退出后输出保留 5 分钟；任务页与 Missions 可同时查看。
- 注入 `TOWER_TASK_ID`、`TOWER_TASK_TITLE`、`TOWER_API_URL` 和可选 `CALLBACK_URL`，额外变量通过受控 env patch 合并。
- 生产 `tower` 仅允许绑定 `127.0.0.1`、`localhost` 或 `::1`，并拒绝 `0.0.0.0` 和局域网地址；HTTP、WebSocket、origin 和内部路由共享该生产解析结果。dev/preview 配置不受此项改变。

核心实现位于 `src/actions/agent-actions.ts`、`src/lib/ai/terminal-target.ts`、`src/lib/pty/` 和 `/api/internal/terminal/[taskId]/*`。
