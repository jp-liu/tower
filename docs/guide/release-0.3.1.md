---
title: 0.3.1 发布说明
description: 可靠 Workbench 网关、个人机器人权限、无人值守服务与消息卡片
---

# Tower 0.3.1

0.3.1 将 Tower 的项目 Workbench 从进程内调度升级为可恢复的持久工作流，并补齐个人机器人接入、远程项目评审和跨平台无人值守服务。

## 主要变化

- 持久 Workbench inbox、批次 ACK/租约、heartbeat、恢复扫描和 generation fencing。
- Gateway ingress、任务创建确认、Workbench 审查和 FINAL_RESULT outbox 形成可恢复闭环。
- `Task=DONE`、最终回复意图和 Gateway 业务完成状态在同一数据库事务中提交。
- 外部消息采用 at-least-once 投递；不确定的平台发送进入 `SENT_UNVERIFIED`，避免盲目重复发送。
- OWNER 与 NON_OWNER 路由分离：非持有人只能查询已授权项目，不能创建任务、修改 Tower 数据或操作电脑。
- 支持远程 Git 项目的只读评审与经所有者授权的完整工作模式。
- macOS LaunchAgent 与 Windows Scheduled Task 无人值守服务由用户自主安装、查看和移除。
- 飞书任务排队、创建、完成和诊断消息采用结构化卡片。
- Missions 展示 Workbench generation、队列状态和恢复健康度；空队列不再误报 BUSY 或自动复活。

## 可靠性边界

- 一个 Tower 数据库同时只允许一个持有 leader lease 的 runtime 执行后台扫描。
- Workbench 事件在批次 `RESOLVED` 前不会释放处理责任。
- 飞书或其他平台投递失败不会回滚已完成的业务任务；delivery worker 独立重试。
- 远程项目默认不执行不可信脚本；FULL_WORK 仅对机器人持有人开放。

## 发布验证

- 全量 Vitest：235 个测试文件通过，2165 条测试通过。
- 生产构建、release gate、package canary、入口检查和 npm pack dry-run 通过。
- Playwright 使用独立临时数据库和专用端口，不复用本机 3000 服务或用户数据。

完整架构与运维资料见 [Workbench 可靠网关](/modules/workbench-gateway)、[Harness 无人值守](/modules/harness)、[无人值守服务](/guide/unattended-service) 和 [架构图](/guide/diagrams)。
