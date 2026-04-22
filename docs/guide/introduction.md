---
title: 介绍
description: Tower 是什么，核心概念与技术栈总览
---

## 什么是 Tower

Tower 是一个面向个人开发者的 AI 任务调度平台，将看板管理、终端交互、代码编辑和 MCP 工具链整合在一起，提供统一的任务管理和 AI Agent 协作环境。

## 为什么做 Tower

AI 改变了开发者的工作方式。以前做项目，你一步步写代码，遇到问题改需求，同步更新代码，节奏是自己掌控的。

现在不一样了。AI 接管了大部分编码工作，人的角色从「写代码」变成了「审代码」。项目数量也多了——同时推进几个项目成了常态。

问题随之而来：

- **频繁打断** — 随时可能插进来一个新任务或修改，打断你当前的思路。刚看完一个 PR，转头去处理另一个项目的 bug，回来已经忘了刚才看到哪了。
- **上下文丢失** — 一会儿做这个一会儿做那个，某些改动、决策、踩过的坑，没有地方记录，等回过头来已经想不起来了。
- **无法复盘** — 任务执行过程中产生的对话、代码变更、终端日志散落各处，后续想要回顾、总结、沉淀经验，无从下手。

Tower 要解决的就是这件事：**给每个任务一个完整的记录空间**。

任务的对话记录、终端日志、代码变更、文件资产、执行摘要——全部自动沉淀在一个地方。你可以随时切换任务而不怕丢失上下文，也可以在任务完成后借助 AI 做复盘分析（Dreaming），把遇到的问题和经验提炼成结构化的知识。

后续还会接入个人知识库，让这些沉淀真正可查询、可复用。

## 核心概念

Tower 的数据模型采用三层层级结构：

```
Workspace → Project → Task
```

- **Workspace（工作区）**：顶层容器，管理项目和标签的命名空间
- **Project（项目）**：属于某个 Workspace，承载任务和代码仓库，支持普通项目和 Git 项目
- **Task（任务）**：核心工作单元，通过状态（TODO / IN_PROGRESS / IN_REVIEW / DONE / CANCELLED）在看板列间流转

每个 Task 可以关联标签、执行记录和消息，支持 AI Agent 自动执行。

## 技术栈

| 技术 | 说明 |
|------|------|
| **Next.js 16** | App Router，全栈框架 |
| **TypeScript** | 类型安全 |
| **SQLite + Prisma** | 轻量数据库 + ORM |
| **TailwindCSS 4** | 原子化 CSS |
| **shadcn (base-nova)** | UI 组件库 |
| **xterm.js + node-pty** | 终端模拟 |
| **Monaco Editor** | 代码编辑器 |
| **MCP Protocol** | AI 工具协议 |

## 功能总览

- **看板管理** — 拖拽排序、标签筛选、优先级管理
- **AI 终端** — 每个任务独立的 Claude CLI 终端会话
- **代码编辑** — Monaco Editor 多标签编辑、Git Diff 视图
- **MCP 工具链** — 24+ 工具供外部 AI Agent 调用
- **多任务监控** — Missions 面板实时监控多个执行
- **全局搜索** — 任务、项目、仓库全文搜索
- **国际化** — 中英文双语支持

## 模块文档

Tower 由以下 14 个模块组成：

| 模块 | 说明 |
|------|------|
| [Workspace](../modules/workspace) | 工作区管理 |
| [Project](../modules/project) | 项目管理 |
| [Task](../modules/task) | 任务管理 |
| [Board](../modules/board) | 看板 UI |
| [Terminal](../modules/terminal) | PTY 终端系统 |
| [Assistant](../modules/assistant) | AI 助手聊天 |
| [Missions](../modules/missions) | 多任务监控 |
| [Search](../modules/search) | 全局搜索 |
| [Settings](../modules/settings) | 系统配置 |
| [MCP](../modules/mcp) | MCP Server |
| [Git](../modules/git) | Git 集成 |
| [Assets & Notes](../modules/assets-notes) | 资产和笔记 |
| [AI](../modules/ai) | AI 能力层 |
| [I18n](../modules/i18n) | 国际化 |
