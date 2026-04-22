---
title: Missions 模块
description: 多任务监控面板，跨工作区展示所有运行中的 Task 执行
---

**Slug:** `missions`

## 功能介绍

Mission Control 是多任务监控面板，跨工作区展示所有正在运行的任务执行，每个卡片嵌入实时终端，可以同时观察多个任务的执行状态。

主要能力：

- **网格布局**：支持多种预设布局（1x1、2x1、3x2、2x2、4x2、3x3），布局选择持久化到 localStorage，下次打开自动恢复
- **实时终端**：每个任务卡片嵌入 xterm.js 终端，实时显示 Claude CLI 的输出
- **工作区筛选**：通过下拉框按工作区过滤，只显示特定工作区下的运行任务
- **启动新任务**：通过 Task Picker 选择任务启动新的执行
- **恢复历史会话**：选择之前的执行记录，通过 sessionId 恢复 Claude CLI 会话
- **拖拽排序**：使用 dnd-kit 拖拽调整卡片顺序
- **自动更新**：4 秒轮询刷新执行状态，任务完成后卡片自动移除
- **停止执行**：手动停止正在运行的任务，卡片随即移除

## 详细说明

### 卡片生命周期

- 启动执行或恢复会话后，卡片出现在面板中
- 执行过程中实时显示终端输出
- 手动停止或自然完成后，卡片自动从面板移除
- 通过 4 秒轮询检测状态变化

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
