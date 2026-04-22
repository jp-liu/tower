---
title: Project 模块
description: 项目管理，支持普通项目和 Git 项目两种类型
---

**Slug:** `project`

## 功能介绍

项目属于工作区，是任务的组织单元。可以关联 Git 仓库或本地目录，创建时根据是否提供 Git URL 自动判定项目类型（普通项目 / Git 项目）。

主要操作：

- **创建项目**：在工作区下新建项目，填写名称、别名、描述等基本信息
- **关联 Git 仓库**：提供 Git URL 后自动标记为 GIT 类型项目，支持后续的 Worktree 隔离执行和 Diff/Merge 功能
- **关联本地目录**：指定 localPath，用于代码搜索、预览、项目分析等功能
- **生成描述**：点击「生成描述」按钮，AI 自动分析项目的 localPath 目录结构，生成结构化的项目描述
- **导入本地项目**：通过导入对话框选择本地目录，自动检测 Git remote 信息并填充
- **删除项目**：级联删除项目下的所有任务

## 详细说明

### 数据模型

```
Project (id, name, alias?, description?, type, gitUrl?, localPath?)
  ├── Task[]
  └── Repository[]
```

- `type`: `NORMAL` | `GIT`，由 `gitUrl` 是否存在自动推导，不可手动设置
- `workspaceId`: FK → Workspace，级联删除

### 项目类型

项目类型由 `gitUrl` 字段自动推导：
- 提供了 `gitUrl` → `GIT` 类型，支持 Worktree 隔离、Diff 查看、Merge 操作
- 未提供 `gitUrl` → `NORMAL` 类型，仅支持基础任务管理

## 文件清单

### Server Actions (`src/actions/`)

| 文件 | 函数 | 说明 |
|------|------|------|
| `workspace-actions.ts` | `createProject`, `updateProject`, `deleteProject` | 项目 CRUD |
| `workspace-actions.ts` | `getProjectByLocalPath(path)` | 按本地路径查找 |
| `workspace-actions.ts` | `getRecentLocalProjects(limit?)` | 最近本地项目 |
| `project-actions.ts` | 项目分析相关 | 项目描述生成等 |

### 组件 (`src/components/project/`)

| 组件 | 说明 |
|------|------|
| `create-project-dialog.tsx` | 创建项目对话框 |
| `import-project-dialog.tsx` | 导入项目对话框 |

### MCP Tools (`src/mcp/tools/project-tools.ts`)

- `list_projects` / `create_project` / `update_project` / `delete_project` / `identify_project`

## 约束

- `type` 字段只读，由 `gitUrl` 存在性决定
- 删除项目级联删除所有 Task
