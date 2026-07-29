---
title: Workbench 可靠网关
description: 外部消息、权限路由、持久队列、任务审查与回传的可靠闭环
---

# Workbench 可靠网关

Workbench 网关把飞书、微信及 OpenClaw/Hermes 支持的平台接入 Tower，同时保证
身份、项目范围、任务执行与原消息回传不会失去归属关系。

![o-tower 目标架构](/diagrams/o-tower-personal-assistant-target-architecture.drawio.png)

[下载可编辑 Draw.io 源文件](/diagrams/o-tower-personal-assistant-target-architecture.drawio)

## 核心边界

### OWNER

机器人持有人可以：

- 查询工作区、项目、任务和运行状态；
- 发起项目讨论；
- 把工作请求路由到项目驻留 Workbench；
- 使用诊断工具定位外部消息链路。

消息入口本身不拥有 `create_task`、任务增删改或终端启动工具。所有写操作必须由
绑定项目的 Workbench 执行，避免入口 Agent 绕过审核重复建任务。

### NON_OWNER

同事仅能在可信群中查询该群绑定工作区内的项目：

- 无工作区 scope 时 fail-closed；
- 不返回个人任务、个人日报或本地路径；
- 不能创建、修改、启动或删除任务；
- 陌生群和无法验证身份的请求直接返回权限不足。

## 请求类型

| 类型 | 行为 | 是否创建任务 |
|---|---|---|
| `GENERAL` | 普通对话或非 Tower 内容 | 否 |
| `PROJECT_DISCUSSION` | 使用项目会话历史与只读上下文回答 | 否 |
| `PROJECT_WORK` | 持久化入站事件并交给驻留 Workbench | Workbench 审核后创建 |
| `REMOTE_PROJECT` | OWNER 提供 Git 与落盘位置后接入项目 | 根据模式决定 |

## 工作闭环

![Workbench 网关时序](/diagrams/workbench-gateway-sequence.drawio.png)

[下载可编辑 Draw.io 源文件](/diagrams/workbench-gateway-sequence.drawio)

1. 平台事件经过签名验证，携带稳定的 `senderId`、`chatId` 和消息 ID。
2. Tower 先写入 `GatewayInbound`，再回复排队卡片。
3. 项目 Workbench 通过带租约和 fencing token 的持久 batch 获取请求并显式 ACK。
4. Workbench 创建唯一的 `GatewayTaskLink`，随后启动子任务。
5. 子任务进入 `IN_REVIEW` 后，由 Workbench 核对原始约束和证据。
6. `Task=DONE` 与 `FINAL_RESULT/PENDING` 原子提交。
7. Outbox 以原平台消息为 parent 投递引用卡片，并使用稳定键去重。
8. 只有 `resolve_workbench_batch` 成功后，关联事件才最终变为 `CONSUMED`。

## 可靠性不变量

- 一个 inbound 最多关联一个外部工作任务。
- PTY 收到文本和 ACK 都不代表事件已最终消费；只有 `RESOLVED` 才释放处理责任。
- `CLAIMED`、`DISPATCHED`、`ACKED` 都有租约；租约过期会以同一 batch ID 安全重放。
- ACK、heartbeat 和 resolve 必须携带当前 generation 的 lease token，旧终端不能确认新批次。
- 服务重启后从 SQLite inbox/outbox 恢复，不依赖终端画面或内存。
- 无人值守提问先持久化 `HarnessOutbound` 和 ask intent，再由 worker 发送；失败可恢复。
- 一个 Tower 数据库同一时刻只允许一个 runtime leader，避免两个扫描器同时拥有 PTY。
- `REVIEW_ONLY` 项目不能创建可执行任务或启动终端。
- OpenClaw 入口只拥有路由、只读查询和诊断工具。
- sender、chat、项目、Workbench 和全局排队数量均有限流与硬上限。

## 远程项目模式

| 模式 | 能力 |
|---|---|
| `REVIEW_ONLY` | clone、读取、索引、讨论和评审报告；禁止启动不可信脚本 |
| `FULL_WORK` | OWNER 明确升级后允许安装依赖、修改代码和提交 |

Git 地址会转换为规范化 `repositoryKey`，并发接入相同仓库时只保留一个项目。
没有提供工作区或本地根目录时，Tower 会继续询问，不擅自选择。

## 诊断

- `diagnose_gateway_request`：按 inbound 或平台消息 ID 查看阶段时间线。
- `get_gateway_runtime_health`：查看 Tower、OpenClaw/Hermes 健康与脱敏日志。
- 运行健康还包含 runtime leader、Workbench 租约批次和 Harness outbox 状态。
- Missions Workbench 卡片：查看 generation、heartbeat、batch 和阻塞原因。
- `tower service status`：查看操作系统守护状态。

## 相关图

- [访问与权限路由时序图](/diagrams/o-tower-access-routing-sequence.drawio.png)
- [Workbench 可靠架构图](/diagrams/workbench-reliable-architecture.drawio.png)
- [Batch 状态机](/diagrams/workbench-batch-state-machine.drawio.png)
- [无人值守外发 Outbox](/diagrams/harness-outbox-state-machine.drawio.png)
