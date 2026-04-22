---
title: Task 模块
description: Tower 的核心工作单元，支持标签、执行记录、消息等关联
---

**Slug:** `task`

## 功能介绍

任务是 Tower 的核心工作单元，在看板上以卡片形式展示。每个任务属于一个项目，通过状态字段在看板列间流转。

主要能力：

- **状态流转**：支持 5 种状态 — TODO → IN_PROGRESS → IN_REVIEW → DONE → CANCELLED，拖拽卡片或右键菜单即可切换
- **优先级**：4 个级别 — LOW / MEDIUM / HIGH / CRITICAL，影响卡片上的优先级徽章显示
- **自定义标签**：关联工作区标签池中的标签，支持多标签组合筛选
- **置顶**：置顶的任务始终显示在看板列顶部
- **基础分支设置**：可以指定 Git 基础分支，任务执行时自动创建 Worktree 在独立分支中工作，不影响主分支
- **执行任务**：点击执行后自动创建 PTY 终端会话，Claude CLI 在独立环境中运行任务
- **执行摘要**：任务完成后自动生成执行摘要（50 字简述）和 Dreaming 洞察（结构化 JSON），洞察自动保存为笔记

## 详细说明

### 数据模型

```
Task (id, title, description?, status, priority, order)
  ├── TaskLabel[] → Label
  ├── TaskExecution[]
  └── TaskMessage[]
```

- `status`: `TODO` | `IN_PROGRESS` | `IN_REVIEW` | `DONE` | `CANCELLED`
- `priority`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`
- `order`: 看板列内排序（升序，小值在上）
- `projectId`: FK → Project，级联删除

### Label 子系统

- Server Actions: `src/actions/label-actions.ts`
- MCP Tools: `src/mcp/tools/label-tools.ts`
- `set_task_labels` / `setTaskLabels` 执行全量替换（非合并）

## 文件清单

### Server Actions (`src/actions/task-actions.ts`)

| 函数 | 说明 |
|------|------|
| `createTask({ title, projectId, ... })` | 创建任务 |
| `updateTask(taskId, data)` | 更新任务 |
| `updateTaskStatus(taskId, status)` | 状态流转 |
| `deleteTask(taskId)` | 删除任务 |
| `getProjectTasks(projectId)` | 获取项目下所有任务 |

### 页面

| 路由 | 文件 | 说明 |
|------|------|------|
| `/workspaces/[id]/tasks/[taskId]` | `task-page-client.tsx` | 任务详情页 |

### 组件 (`src/components/task/`)

| 组件 | 说明 |
|------|------|
| `task-detail-panel.tsx` | 任务元信息面板 |
| `task-terminal.tsx` | 终端 UI |
| `task-diff-view.tsx` | Git diff 视图 |
| `task-merge-confirm-dialog.tsx` | 合并确认 |
| `code-editor.tsx` | 代码编辑器 |
| `file-tree.tsx` | 文件树 |
| `execution-timeline.tsx` | 执行历史时间线 |

### MCP Tools (`src/mcp/tools/task-tools.ts`)

- `list_tasks` / `create_task` / `update_task` / `move_task` / `delete_task`

## 约束

- `order` 字段控制看板排序，创建时不要破坏现有排序
- Label 替换是全量操作，需传完整 labelIds 数组
- 删除任务级联删除 Message 和 Execution
