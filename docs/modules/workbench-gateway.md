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

同事仅能在 OWNER 已授权的群中进行只读查询：

- `ALL` 可查询全部工作区和项目；`WORKSPACE/PROJECTS` 强制追加范围过滤；
- 未授权、已撤销或绑定资源失效时 fail-closed；
- 不返回个人任务、个人日报或本地路径；
- 不能创建、修改、启动或删除任务；
- 陌生群和无法验证身份的请求直接返回权限不足。

OWNER 在当前群内通过 `manage_gateway_channel_access` 授权、绑定、解绑或撤销。
扩展配置保存状态，OpenClaw 控制 sender 工具面，Tower 负责最终数据范围校验。

## 请求类型

| 类型 | 行为 | 是否创建任务 |
|---|---|---|
| `GENERAL` | 普通对话或非 Tower 内容 | 否 |
| `PROJECT_DISCUSSION` | 以 `GATEWAY_DISCUSSION_REQUEST` 交给项目 Workbench 直接回答 | 否 |
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

## 三层独立状态

Workbench 不能用一套状态同时表示终端回合、可靠消费和运维健康：

1. live PTY Provider 回合记录当前是否 `BUSY`；`writeRaw` 只透传终端字节，不更新
   `lastInputAt`，也不改变回合状态。`writeSubmittedInput` 才是语义提交，会更新
   `lastInputAt`、关闭一次性 drain boundary，并进入 `BUSY`。
2. `WorkbenchEvent` / `WorkbenchBatch` 保存 durable delivery 状态。批次
   `RESOLVED`、事件 `CONSUMED` 只表示处理责任已经释放，不表示 Provider 回合结束。
3. `WorkbenchRuntime` 是持久化的运维投影。批次已 `RESOLVED` 时它仍可能是 `BUSY`；
   只有 Provider Stop/turn-complete 才把它更新为 `IDLE`，开放一次 drain boundary，并
   尝试下一条 `PENDING`。

Stop hook 丢失时，可以用 Provider transcript 恢复边界：Claude 使用
`stop_reason=end_turn`；Codex 的 `task_complete` 必须不早于 live session 最后一次语义
提交。终端静默、output-idle 和终端协议字节都不是完成证据。当前实现没有持久化逐轮
`turnId` / `turnSeq`。

## 可靠性不变量

- 一个 inbound 最多关联一个外部工作任务。
- PTY 收到文本和 ACK 都不代表事件已最终消费；只有 `RESOLVED` 才释放处理责任。
- `RESOLVED` 不会把仍在运行的 Provider 回合提前标成 `IDLE`。
- `CLAIMED`、`DISPATCHED`、`ACKED` 都有租约；租约过期会以同一 batch ID 安全重放。
- ACK、heartbeat 和 resolve 必须携带当前 generation 的 lease token，旧终端不能确认新批次。
- 未解决的批次每两分钟续租一次，不能等五分钟处理租约到期后才 heartbeat。
- 服务重启后从 SQLite inbox/outbox 恢复，不依赖终端画面或内存。
- 无人值守提问先持久化 `HarnessOutbound` 和 ask intent，再由 worker 发送；失败可恢复。
- 隐式内容去重只覆盖当前 ask 生命周期；上一轮已回答后，相同问题会建立新的发送周期。显式 dedup key 始终保持严格幂等。
- `GatewayTaskLink` 同时引用 inbound 与 task 并级联清理，恢复逻辑不会把孤儿 link 当作任务存在的证据。
- 一个 Tower 数据库同一时刻只允许一个 runtime leader，避免两个扫描器同时拥有 PTY。
- `REVIEW_ONLY` 项目不能创建可执行任务或启动终端。
- OpenClaw 入口只拥有路由、只读查询和诊断工具。
- sender、chat、项目、Workbench 和全局排队数量均有限流与硬上限。

## 运行数据生命周期

这里要区分三类数据：

- `WorkbenchEvent.payload` 是可重放输入；`CONSUMED` 事件仍可能因恢复而重新排队，
  因此 V1 在任何状态都保留完整 payload。
- `WorkbenchBatch.prompt`、`GatewayInbound` 和 `GatewayDelivery` 中的正文是协议运行时
  的重复副本；只有在可证明已稳定结束时才可能成为压缩候选。
- `WorkbenchEvent`、`WorkbenchBatch`、`GatewayInbound`、`GatewayDelivery` 和
  `GatewayTaskLink` 的小型身份字段是幂等 tombstone，不能因“已消费”直接删除。

Tower 在已有的六小时 Harness sweep 中做只读观测，不新增 timer。Workbench 以
`RESOLVED > 24h` 为候选窗口；Gateway 以七天为窗口，并要求 `PROCESSED` inbound
没有非 `DELIVERED` delivery，同时 `DELIVERED` delivery 必须关联仍为 `PROCESSED`
的 inbound。`SENT_UNVERIFIED`、活动、失败和可重试状态永远不算稳定结束。

2026-08-01 的真实本地库样本中，全部候选文本只有 70,062 bytes，约占 44.9 MB
数据库的 0.16%。因此当前版本只记录按状态行数、总文本 bytes、候选行数和候选
bytes，**不执行压缩或删除**。日志不包含消息正文。未来只有在增长数据证明收益后，
才重新评审并启用有原子状态/关系护栏的写入。

这不是敏感数据删除承诺；同一内容仍可能存在于 `TaskMessage`、终端日志、应用日志
和备份中，备份按自己的保留策略处理。现有架构图无需修改，因为 owner 边界、关系和
数据流均未改变。

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
