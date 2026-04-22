---
title: Introduction
description: What Tower is, core concepts, and tech stack overview
---

## What is Tower

Tower is an AI task orchestration platform for individual developers. It integrates Kanban board management, terminal interaction, code editing, and an MCP toolchain into a unified environment for task management and AI agent collaboration.

## Why Tower

AI has changed how developers work. Before, you'd write code step by step, adjust requirements when issues came up, and keep everything in sync at your own pace.

That's no longer the case. AI now handles most of the coding, and your role has shifted from *writing code* to *reviewing code*. You're also juggling more projects than ever — running several in parallel has become the norm.

This creates real problems:

- **Constant interruptions** — A new task or change request can drop in at any moment, breaking your train of thought. You finish reviewing a PR, switch to debug something in another project, and by the time you're back, you've lost your place.
- **Lost context** — Bouncing between tasks means decisions, changes, and lessons learned slip through the cracks. There's nowhere to capture them, and by the time you need them again, they're gone.
- **No way to review** — Conversations, code changes, terminal logs — they're scattered everywhere. When you want to look back, summarize, or extract lessons from a completed task, there's nothing to work with.

Tower exists to fix this: **give every task a complete record**.

Conversations, terminal logs, code diffs, file assets, execution summaries — everything is automatically captured in one place. You can switch between tasks without losing context, and once a task is done, use AI-powered review (Dreaming) to distill problems and insights into structured knowledge.

Down the road, this feeds into a personal knowledge base — making everything searchable and reusable.

## Core Concepts

Tower's data model follows a three-level hierarchy:

```
Workspace → Project → Task
```

- **Workspace**: Top-level container that manages the namespace for projects and labels
- **Project**: Belongs to a Workspace, holds tasks and code repositories. Supports both regular and Git-based projects
- **Task**: The core work unit that flows across Kanban columns via status (TODO / IN_PROGRESS / IN_REVIEW / DONE / CANCELLED)

Each Task can be associated with labels, execution records, and messages, with support for automated AI agent execution.

## Tech Stack

| Technology | Description |
|------------|-------------|
| **Next.js 16** | App Router, full-stack framework |
| **TypeScript** | Type safety |
| **SQLite + Prisma** | Lightweight database + ORM |
| **TailwindCSS 4** | Utility-first CSS |
| **shadcn (base-nova)** | UI component library |
| **xterm.js + node-pty** | Terminal emulation |
| **Monaco Editor** | Code editor |
| **MCP Protocol** | AI tool protocol |

## Feature Overview

- **Kanban Board** -- Drag-and-drop sorting, label filtering, priority management
- **AI Terminal** -- Independent Claude CLI terminal session per task
- **Code Editing** -- Monaco Editor with multi-tab editing and Git diff view
- **MCP Toolchain** -- 24+ tools for external AI agent integration
- **Multi-task Monitoring** -- Missions panel for real-time monitoring of multiple executions
- **Global Search** -- Full-text search across tasks, projects, and repositories
- **Internationalization** -- Chinese and English bilingual support

## Module Documentation

Tower consists of the following 14 modules:

| Module | Description |
|--------|-------------|
| [Workspace](../modules/workspace) | Workspace management |
| [Project](../modules/project) | Project management |
| [Task](../modules/task) | Task management |
| [Board](../modules/board) | Kanban UI |
| [Terminal](../modules/terminal) | PTY terminal system |
| [Assistant](../modules/assistant) | AI assistant chat |
| [Missions](../modules/missions) | Multi-task monitoring |
| [Search](../modules/search) | Global search |
| [Settings](../modules/settings) | System configuration |
| [MCP](../modules/mcp) | MCP Server |
| [Git](../modules/git) | Git integration |
| [Assets & Notes](../modules/assets-notes) | Assets and notes |
| [AI](../modules/ai) | AI capability layer |
| [I18n](../modules/i18n) | Internationalization |
