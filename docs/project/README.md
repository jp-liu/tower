# Project 模块

**Slug:** `project`

## 概述

Project 属于某个 Workspace，承载 Task 和 Repository。支持普通项目和 Git 项目两种类型。

## 数据模型

```
Project (id, name, alias?, description?, type, gitUrl?, localPath?)
  ├── Task[]
  └── Repository[]
```

- `type`: `NORMAL` | `GIT`，由 `gitUrl` 是否存在自动推导，不可手动设置
- `workspaceId`: FK → Workspace，级联删除

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
