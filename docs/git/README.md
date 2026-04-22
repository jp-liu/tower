# Git 模块

**Slug:** `git`

## 概述

Git 操作集成，包括仓库克隆、Worktree 隔离、Diff 解析、Merge 操作。

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

## Worktree 机制

- 每个 Task 执行可在独立 worktree 中进行
- `TaskExecution.worktreePath` / `worktreeBranch` 记录隔离信息
- 创建任务时通过 `useWorktree` / `baseBranch` 参数控制
