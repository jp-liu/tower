---
title: Git 模块
description: Git 操作集成，包括仓库克隆、Worktree 隔离、Diff 解析、Merge 操作
---

**Slug:** `git`

## 功能介绍

Git 集成提供 Worktree 隔离执行能力，让每个任务在独立分支中工作，不影响主分支。

主要能力：

- **Worktree 隔离**：任务执行时自动创建 Git Worktree，在独立分支中工作。Claude CLI 的所有代码修改都在隔离的工作目录中进行，不影响项目主分支
- **Diff 查看**：任务完成后可以查看工作分支与基础分支之间的代码差异，逐文件浏览变更内容
- **一键合并**：确认 Diff 无误后，通过合并确认对话框将工作分支的修改合并回基础分支
- **仓库克隆**：支持从 Git URL 克隆仓库到本地
- **分支管理**：管理项目的分支信息
- **自动检测**：导入本地项目时自动检测 Git remote 信息，填充 Git URL

## 详细说明

### Worktree 机制

- 创建任务时通过 `useWorktree` / `baseBranch` 参数控制是否启用 Worktree 隔离
- 每个 Task 执行可在独立 worktree 中进行
- `TaskExecution.worktreePath` / `worktreeBranch` 记录隔离信息
- 执行完成后，工作分支的修改可以通过 Merge 操作合并回基础分支

### Git 路径映射

在设置页面配置 host/owner 到本地路径的映射规则后，导入 Git 项目时可以自动解析 Git URL 对应的本地目录。

## 文件清单

### Server Actions (`src/actions/git-actions.ts`)

Git 克隆、分支管理等操作。

### API Routes

| 路由 | 说明 |
|------|------|
| `/api/git/route.ts` | Git 操作 API |
| `/api/tasks/[taskId]/diff/route.ts` | 获取任务 diff |
| `/api/tasks/[taskId]/merge/route.ts` | 执行 merge |

### 核心库

| 文件 | 说明 |
|------|------|
| `lib/git-url.ts` | Git URL 解析和规范化 |
| `lib/worktree.ts` | Git worktree 创建和管理 |
| `lib/diff-parser.ts` | Git diff 解析器 |

### 组件

| 组件 | 说明 |
|------|------|
| `task-diff-view.tsx` | Diff 可视化 |
| `task-merge-confirm-dialog.tsx` | Merge 确认对话框 |
