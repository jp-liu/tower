---
title: Board 模块
description: 看板 UI，Kanban 列展示任务卡片，支持拖拽排序和筛选
---

**Slug:** `board`

## 功能介绍

看板是任务的可视化管理界面，以 Kanban 列按状态分组展示项目下的任务卡片。

主要能力：

- **5 列看板**：按 TODO、IN_PROGRESS、IN_REVIEW、DONE、CANCELLED 五种状态分列展示
- **拖拽移动**：拖拽卡片跨列移动自动更新任务状态，同列内拖拽调整排序
- **右键菜单**：右键点击任务卡片可以快速切换状态、启动执行、跳转到任务详情页
- **标签筛选**：按标签过滤显示，只展示包含选中标签的任务
- **优先级筛选**：按优先级过滤，快速定位高优任务
- **任务卡片**：每张卡片显示标题、描述摘要、优先级徽章、标签列表
- **置顶功能**：置顶的任务始终显示在所在列的顶部，不受排序影响
- **归档视图**：已完成和已取消的任务可以在归档页面查看

## 详细说明

### 交互行为

- 拖拽卡片跨列 → 调用 `updateTaskStatus` 更新状态
- 拖拽卡片同列 → 更新 `order` 字段调整排序
- 筛选 → 按标签、优先级组合过滤显示

### 状态管理

使用 Zustand store（`src/stores/board-store.ts`）管理列状态、筛选条件、拖拽状态。

## 文件清单

### 组件 (`src/components/board/`)

| 组件 | 说明 |
|------|------|
| `kanban-board.tsx` | 看板主容器 |
| `board-column.tsx` | 状态列 |
| `task-card.tsx` | 任务卡片 |
| `board-filters.tsx` | 筛选器（标签、优先级） |
| `board-stats.tsx` | 统计面板 |

### 页面

| 路由 | 说明 |
|------|------|
| `/workspaces/[workspaceId]` | 看板主页面 (`board-page-client.tsx`) |
| `/workspaces/[workspaceId]/archive` | 归档任务 (`archive-page-client.tsx`) |

### 状态管理 (`src/stores/board-store.ts`)

Zustand store，管理列状态、筛选条件、拖拽状态。
