---
title: Git
description: Git integration including repository cloning, worktree isolation, diff parsing, and merge operations
---

# Git Module

**Slug:** `git`

## Overview

Git integration provides worktree isolation so each task can work on an independent branch without affecting the main codebase. After a task execution completes, you can view diffs comparing the task branch against the base branch, and merge changes back with a single click. Tower also supports repository cloning, branch management, and auto-detection of Git information when importing a local project.

## Details

- **Worktree isolation**: When a task is created with `useWorktree` enabled and a `baseBranch` specified, Tower creates a separate Git worktree for that task's execution. This means the agent works in a completely isolated copy of the repository on its own branch.
- **Diff viewing**: After execution, the task detail page shows a side-by-side diff of all changes made on the task branch compared to the base branch.
- **One-click merge**: Review the diff and merge the task branch back into the base branch directly from the UI, with a confirmation dialog to prevent accidental merges.
- **Auto-detection on import**: When you import a local project by specifying its directory path, Tower reads the Git remote URL, current branch, and other repository metadata automatically.
- **Git URL resolution**: The Git Path Mapping feature in Settings maps host/owner combinations to local paths, enabling automatic resolution of Git URLs to local directories.

## File Reference

### Server Actions (`src/actions/git-actions.ts`)

Git clone, branch management, and related operations.

### API Routes

| Route | Description |
|-------|-------------|
| `/api/git/route.ts` | Git operations API |
| `/api/tasks/[taskId]/diff/route.ts` | Get task diff |
| `/api/tasks/[taskId]/merge/route.ts` | Execute merge |

### Core Library

| File | Description |
|------|-------------|
| `lib/git-url.ts` | Git URL parsing and normalization |
| `lib/worktree.ts` | Git worktree creation and management |
| `lib/diff-parser.ts` | Git diff parser |

### Components

| Component | Description |
|-----------|-------------|
| `task-diff-view.tsx` | Diff visualization |
| `task-merge-confirm-dialog.tsx` | Merge confirmation dialog |

## Constraints

- Each Task execution can run in an isolated worktree
- `TaskExecution.worktreePath` / `worktreeBranch` record the isolation information
- Controlled via `useWorktree` / `baseBranch` parameters when creating a task
