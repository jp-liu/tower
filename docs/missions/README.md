# Missions 模块

**Slug:** `missions`

## 概述

多任务监控面板，跨工作区展示所有运行中的 Task 执行，嵌入 xterm.js 终端实时查看。

## 功能

- 网格布局预设（1×1, 2×1, 3×2, 2×2, 4×2, 3×3），持久化到 localStorage
- Workspace 过滤下拉框
- 启动新执行 / 恢复历史会话（Task Picker）
- 停止执行（卡片移除）/ 自然完成自动移除
- 拖拽排序（dnd-kit）
- 4 秒轮询实时更新

## 文件清单

### 页面

| 路由 | 文件 | 说明 |
|------|------|------|
| `/missions` | `missions-client.tsx` | Missions 主页面 |

### 组件 (`src/components/missions/`)

| 组件 | 说明 |
|------|------|
| `mission-card.tsx` | 任务执行卡片（含终端） |
| `grid-preset-picker.tsx` | 网格布局选择器 |
| `task-picker-dialog.tsx` | 任务选择对话框 |

### Server Actions

- `getActiveExecutionsAcrossWorkspaces()` — 获取所有 RUNNING 执行

### 状态管理 (`src/stores/task-execution-store.ts`)

Zustand store，管理活跃执行状态。
