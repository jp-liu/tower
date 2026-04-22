---
title: Workspace 模块
description: Tower 顶层容器，管理项目和标签的命名空间
---

**Slug:** `workspace`

## 功能介绍

工作区是 Tower 的顶层容器，可以创建多个工作区来组织不同团队或项目群。每个工作区有独立的标签池，工作区下的项目共享这些标签。

主要操作：

- **创建工作区**：指定名称和可选描述，作为项目的顶层分组
- **重命名和描述编辑**：随时更新工作区名称和描述信息
- **删除工作区**：级联删除工作区下的所有项目和任务，操作不可逆
- **标签管理**：每个工作区有独立的标签池，除了全局内置标签外，可以创建工作区专属标签供项目内的任务使用

## 详细说明

### 数据模型

```
Workspace (id, name, description?)
  ├── Project[]
  └── Label[]
```

- `id`: cuid
- `name`: 必填
- `description`: 可选
- 级联删除：删除 Workspace 会删除所有 Project 和 Label

### 标签体系

工作区下的 Label 分为两类：
- **builtin（内置标签）**：全局共享，不可删除，所有工作区可见
- **workspace-scoped（工作区标签）**：仅在当前工作区内可见，可以自由创建和删除

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
