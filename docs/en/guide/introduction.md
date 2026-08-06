---
title: Introduction
description: How Tower organizes AI development into executable, reviewable tasks
---

# What Tower does

Tower is an AI task orchestration platform for developers. It keeps tasks, CLI
agents, code changes, and acceptance evidence in one workflow so you can run
several projects without losing context across terminals and chat windows.

## The basic workflow

1. Create a task in a project.
2. Start an execution with the selected CLI agent in the task workbench.
3. Follow progress in the Workbench or Mission Control and provide input when needed.
4. Review terminal results, code diffs, and test evidence.
5. Move accepted work to the completed state.

Tower records execution; it does not decide whether code is safe to merge or
publish. A person still owns final acceptance and irreversible operations.

## Core hierarchy

```text
Workspace
  -> Project
    -> Task
      -> Execution
```

- A **Workspace** separates a business or personal environment.
- A **Project** connects repositories, local paths, knowledge, and tasks.
- A **Task** defines one deliverable and moves through the Kanban states.
- An **Execution** records one agent terminal run and its session identity.

## Choose the next page

- To run Tower, read [Install and run](./getting-started).
- To configure models or CLIs, read [AI Tools](./ai-tools).
- To understand OpenClaw, Gateway, Workbench, and MCP, read the
  [automation responsibility map](./automation).
- To inspect internal components, read [System architecture](./architecture) or
  the [module reference](../modules/workspace).
