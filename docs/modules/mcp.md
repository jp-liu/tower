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
- **终端交互**：启动任务执行、查询终端输出、发送终端输入、获取执行状态
- **搜索**：全局搜索任务、项目、仓库
- **知识识别**：按名称/别名/描述模糊匹配定位项目
- **知识库问答**：聚合仓库知识 markdown、事实卡、版本 commit、笔记回答项目问题
- **笔记和资产**：管理项目笔记和资产文件（截图、上传）
- **报告**：每日摘要、每日待办
- **Harness 消息**：无人值守下向人推送消息、登记问题并挂起任务、回灌回复（详见 [Harness 模块](./harness)）

共 42 个工具，分 11 大类。

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
- `POST /api/internal/terminal/[taskId]/start` — 启动终端会话
- `POST /api/internal/terminal/[taskId]/stop` — 关闭终端会话（复用「停止」按钮逻辑）
- `POST /api/internal/terminal/[taskId]/resume` — 启动/继续终端（默认复用「继续/重试」按钮逻辑，无历史则全新启动）
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
| `project-tools.ts` | 6 | Project CRUD + 产品组（product group） |
| `task-tools.ts` | 8 | Task CRUD + move + 默认项 + 版本 + set_goal_mode |
| `label-tools.ts` | 4 | Label CRUD + set_task_labels |
| `search-tools.ts` | 1 | 全局搜索 |
| `knowledge-tools.ts` | 1 | identify_project（项目识别） |
| `knowledge-base-tools.ts` | 2 | ask_project_knowledge / manage_project_facts |
| `note-asset-tools.ts` | 2 | manage_notes / manage_assets |
| `terminal-tools.ts` | 6 | 启动执行 + 终端输出/输入/状态 + 关闭终端 + 启动/继续终端 |
| `report-tools.ts` | 2 | daily_summary / daily_todo |
| `harness-tools.ts` | 6 | 无人值守消息：list_notify_targets / push_to_human / ask_human / notify_human / reply_to_ask / relay_channel_reply（详见 [Harness 模块](./harness)） |
