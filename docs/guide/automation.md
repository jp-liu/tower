---
title: 自动化职责边界
description: Gateway、Workbench、持久协议、MCP 与扩展各自负责什么
---

# 自动化职责边界

Tower 把“消息从哪里来”“项目工作由谁协调”“工具如何调用”和“模型如何执行”拆成独立层。它们可以组合，但不能互相替代。

## 一张表看懂

| 名称 | 负责 | 不负责 |
|---|---|---|
| **Gateway** | 接收外部消息、识别发送者与授权范围、选择 Tower 路由、把最终结果送回原渠道 | 不直接修改仓库，不承担项目推理 |
| **Workbench** | 每个项目的常驻协调器；阅读项目上下文、回答讨论、创建并审查明确授权的任务 | 不是聊天渠道，也不是具体开发任务 |
| **持久协议** | 用 inbox、batch、ACK、lease、heartbeat 和 completion 记录跨进程责任 | 不决定业务内容，不替代 Gateway 或 Workbench |
| **MCP** | 向 AI 客户端暴露有边界的 Tower 工具，例如查询项目、创建任务、控制终端 | 不管理外部聊天平台连接 |
| **OpenClaw 集成** | 把 OpenClaw profile、Tower MCP、skills 和渠道授权接到 Gateway | 不成为 Tower 的数据真源 |
| **AI Provider 扩展** | 把 Claude Code、Codex、Gemini、Qwen 等 CLI/API 适配为统一执行能力 | 不处理 Gateway 授权或 Workbench 队列 |

## 请求如何流动

```text
外部渠道
  -> OpenClaw / 其他接入器
  -> Gateway（身份、授权、路由）
  -> 持久 inbox + Workbench event
  -> 项目 Workbench（讨论或任务协调）
  -> Tower MCP / 子任务终端
  -> 持久 completion + outbox
  -> Gateway
  -> 原消息线程
```

普通 Tower 查询可以在 Gateway 层直接完成，不必唤醒 Workbench。项目讨论进入 Workbench，但不会创建任务。只有用户明确要求创建、修复或执行工作时，Workbench 才创建子任务并负责验收。

## 为什么还需要“持久协议”

进程内函数调用只说明“这次调用返回了”，不能证明重启后责任仍然存在。持久协议把待处理消息和处理权写入数据库：

- `ACK` 表示 Workbench 已接手一个批次，不代表业务完成。
- `lease + heartbeat` 防止两个 runtime 同时处理同一批工作。
- `RESOLVED` 表示该批责任已经处理或被可靠转交。
- completion/outbox 将业务完成与外部投递分开，渠道临时失败不会回滚已经完成的任务。

这套协议是后台可靠性机制。用户界面只需要展示状态、待处理数量和心跳，不需要展示内部代次编号。

## 继续阅读

- [Workbench 协调器](/modules/workbench-gateway)
- [Gateway 消息响应](/modules/gateway-cards)
- [MCP 工具协议](/modules/mcp)
- [Harness 无人值守运行时](/modules/harness)
- [OpenClaw 集成](/modules/agent-extension)
- [CLI Provider 开发](/guide/cli-provider-sdk)
