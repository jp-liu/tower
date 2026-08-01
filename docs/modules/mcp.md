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
- **Harness 与网关路由**：无人值守消息、回灌回复、持久化渠道会话、项目解析、Workbench 排队与完成回传（详见 [Harness 模块](./harness)）

工具名称分组和 profile 归属以 `src/mcp/tool-capabilities.ts` 为唯一来源，文档不再维护容易漂移的手写总数。

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

默认 profile 为 `full`，兼容已有 MCP 配置。可通过 `TOWER_MCP_PROFILE`
选择更小的运行面；未知值会使进程直接启动失败，不会回退到 `full`。

| Profile | 用途 | 能力范围 |
|---------|------|----------|
| `full` | 兼容已有配置 | 完整工具面 |
| `assistant` | Tower 内置 Assistant | core + terminal |
| `task` | Tower 任务终端 | core + terminal + messaging + workbench |
| `gateway` | OpenClaw/Hermes 网关进程 | core/terminal 只读能力 + gateway + operations |
| `gateway-query` | 独立只读网关 | 有界项目查询与讨论回传 |

Profile 是工具发现和可用性的纵深防御，不能替代 OpenClaw/Hermes 的
OWNER/NON_OWNER sender 策略，也不能替代 handler 内的权限和绑定检查。

### 内部 HTTP 桥接

MCP stdio 进程无法访问内存中的 PTY 会话，通过内部 HTTP 路由桥接：
- `GET /api/internal/terminal/[taskId]/buffer` — 获取终端输出
- `POST /api/internal/terminal/[taskId]/input` — 发送终端输入
- `POST /api/internal/terminal/[taskId]/start` — 启动终端会话
- `POST /api/internal/terminal/[taskId]/stop` — 关闭终端会话（复用「停止」按钮逻辑）
- `POST /api/internal/terminal/[taskId]/resume` — 启动/继续终端（默认复用「继续/重试」按钮逻辑，无历史则全新启动）
- `POST/PATCH/PUT /api/internal/harness/gateway` — 网关入站路由、处理完成登记、讨论/任务结果可靠回传
- localhost 限定，仅允许本机访问

## 文件清单

### 核心 (`src/mcp/`)

| 文件 | 说明 |
|------|------|
| `server.ts` | MCP Server 初始化和配置 |
| `db.ts` | MCP 专用数据库连接 |
| `index.ts` | 入口和导出 |
| `tool-capabilities.ts` | 工具能力组、运行 profile 与网关 allowlist 的单一来源 |
| `tool-catalog.ts` | 将能力 profile 映射到实际 schema/handler |

### 工具模块 (`src/mcp/tools/`)

| 文件 | 说明 |
|------|------|
| `workspace-tools.ts` | Workspace CRUD |
| `project-tools.ts` | Project CRUD + 产品组（product group） |
| `task-tools.ts` | Task CRUD + move + 默认项 + 版本 + set_goal_mode |
| `label-tools.ts` | Label CRUD + set_task_labels |
| `search-tools.ts` | 全局搜索 |
| `knowledge-tools.ts` | identify_project（项目识别） |
| `knowledge-base-tools.ts` | ask_project_knowledge / manage_project_facts |
| `note-asset-tools.ts` | manage_notes / manage_assets |
| `terminal-tools.ts` | 启动执行 + 终端输出/输入/状态 + 关闭终端 + 启动/继续终端 |
| `report-tools.ts` | daily_summary / daily_todo |
| `harness/` | messaging、gateway query/owner、Workbench 和 operations 适配器（详见 [Harness 模块](./harness)） |
