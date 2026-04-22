# Board 模块

**Slug:** `board`

## 概述

看板 UI，以 Kanban 列（按 status 分组）展示项目下的 Task 卡片。支持拖拽排序、筛选、统计。

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

## 交互

- 拖拽卡片跨列 → 调用 `updateTaskStatus`
- 拖拽卡片同列 → 更新 `order` 字段
- 筛选 → 按标签、优先级过滤显示
