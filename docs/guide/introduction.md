---
title: 介绍
description: Tower 如何把 AI 开发工作组织成可执行、可审查的任务
---

# Tower 是什么

Tower 是面向开发者的 AI 任务调度平台。它把任务、CLI Agent、代码变更和验收记录
放进同一个工作流，让你可以并行推进多个项目，而不是在终端和聊天窗口之间丢失上下文。

## 基本工作流

1. 在项目中创建任务。
2. 启动执行，让选定的 CLI Agent 在任务工作台中工作。
3. 在 Workbench 或 Mission Control 查看进度，并在需要时补充指令。
4. 检查终端结果、代码 Diff 和测试证据。
5. 通过验收后将任务移入完成状态。

Tower 记录任务执行，但不会替你判断代码是否可以合并或发布。最终验收和不可逆操作
仍由人负责。

## 核心层级

```text
Workspace 工作区
  -> Project 项目
    -> Task 任务
      -> Execution 执行记录
```

- **工作区**隔离不同业务或个人环境。
- **项目**关联代码仓库、本地目录、知识和任务。
- **任务**描述一个可交付结果，并在看板状态间流转。
- **执行记录**保存一次 Agent 终端运行及其会话信息。

## 选择下一步

- 要开始运行：阅读[安装与运行](./getting-started)。
- 要配置模型或 CLI：阅读 [AI Tools](./ai-tools)。
- 要理解 OpenClaw、Gateway、Workbench 和 MCP：阅读[自动化职责边界](./automation)。
- 要查看内部组件：阅读[系统架构](./architecture)或[模块文档](../modules/workspace)。
