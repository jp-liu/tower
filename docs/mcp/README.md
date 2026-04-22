# MCP 模块

**Slug:** `mcp`

## 概述

Model Context Protocol Server，向外部 AI Agent 暴露 Tower 的工具能力。通过 stdio 传输协议运行。

## 启动方式

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

## 内部 HTTP 桥接

MCP stdio 进程无法访问内存中的 PTY 会话，通过内部 HTTP 路由桥接：
- `GET /api/internal/terminal/[taskId]/buffer`
- `POST /api/internal/terminal/[taskId]/input`
- localhost 限定
