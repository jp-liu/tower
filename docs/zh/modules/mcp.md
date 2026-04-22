---
title: MCP 模块
description: Model Context Protocol Server，向外部 AI Agent 暴露 Tower 的工具能力
---

**Slug:** `mcp`

## 功能介绍

Tower 暴露 MCP Server 供外部 AI Agent 调用，通过 stdio 传输协议运行。外部 Agent（如 Claude CLI、OpenClaw、Paperclip）可以通过 MCP 协议管理 Tower 的全部资源。

主要能力：

- **工作区管理**：创建、更新、删除工作区
- **项目管理**：创建、更新、删除项目，识别项目
- **任务管理**：创建、更新、删除、移动任务
- **标签管理**：创建、删除标签，设置任务标签
- **终端交互**：查询终端输出、发送终端输入、获取执行状态
- **搜索**：全局搜索任务、项目、仓库
- **报告**：每日摘要、每日待办
- **笔记和资产**：管理项目笔记和资产文件

共 24 个工具，分 7 大类。

## 详细说明

### 启动方式

```json
{
  "mcpServers": {
    "tower": {
      "command": "npx",
      "args": ["tsx", "<project-root>/src/mcp/index.ts"]
    }
  }
}
```

### 内部 HTTP 桥接

MCP stdio 进程无法访问内存中的 PTY 会话，通过内部 HTTP 路由桥接：
- `GET /api/internal/terminal/[taskId]/buffer` — 获取终端输出
- `POST /api/internal/terminal/[taskId]/input` — 发送终端输入
- localhost 限定，仅允许本机访问

## 文件清单

### 核心 (`src/mcp/`)

| 文件 | 说明 |
|------|------|
| `server.ts` | MCP Server 初始化和配置 |
| `db.ts` | MCP 专用数据库连接 |
| `index.ts` | 入口和导出 |

### 工具模块 (`src/mcp/tools/`)

| 文件 | 工具数 | 说明 |
|------|--------|------|
| `workspace-tools.ts` | 4 | Workspace CRUD |
| `project-tools.ts` | 5 | Project CRUD + identify |
| `task-tools.ts` | 5 | Task CRUD + move |
| `label-tools.ts` | 4 | Label CRUD + set_task_labels |
| `terminal-tools.ts` | 3 | 终端输出/输入/状态 |
| `search-tools.ts` | 1 | 全局搜索 |
| `report-tools.ts` | 2 | daily_summary / daily_todo |
| `note-asset-tools.ts` | — | 笔记和资产管理 |
