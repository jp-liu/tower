# Workspace 模块

**Slug:** `workspace`

## 概述

Workspace 是 Tower 的顶层容器，管理项目和标签的命名空间。

## 数据模型

```
Workspace (id, name, description?)
  ├── Project[]
  └── Label[]
```

- `id`: cuid
- `name`: 必填
- `description`: 可选
- 级联删除：删除 Workspace 会删除所有 Project 和 Label

## 文件清单

### Server Actions (`src/actions/workspace-actions.ts`)

| 函数 | 说明 |
|------|------|
| `getWorkspaces()` | 列出所有工作区 |
| `getWorkspaceById(id)` | 按 ID 获取 |
| `createWorkspace({ name, description? })` | 创建 |
| `updateWorkspace(id, data)` | 更新 |
| `deleteWorkspace(id)` | 删除（级联） |
| `getWorkspacesWithProjects()` | 含项目列表 |
| `getWorkspacesWithRecentTasks(limit?)` | 含最近任务 |

### 页面

| 路由 | 文件 | 说明 |
|------|------|------|
| `/workspaces` | `src/app/workspaces/page.tsx` | 工作区列表 |
| `/workspaces/[id]` | `src/app/workspaces/[workspaceId]/` | 工作区详情（看板） |

### MCP Tools (`src/mcp/tools/workspace-tools.ts`)

- `list_workspaces` / `create_workspace` / `update_workspace` / `delete_workspace`

## 约束

- Workspace 下的 Label 分为 builtin（全局）和 workspace-scoped
- builtin Label 不可删除
