# 无人值守可靠性缺口整改记录（2026-07-29）

## 结论

外部评审指出的三个主要崩溃窗口客观存在。本次整改没有只增加 watchdog，而是把“处理责任”
和“外部发送意图”都变成数据库中的可租赁、可恢复事实。

## 已修复问题

| 评审项 | 原风险 | 当前保证 |
|---|---|---|
| ACK 后崩溃 | 事件已 `CONSUMED`，普通批次永久丢失 | ACK 只续租；`RESOLVED` 才原子消费 |
| CLAIMED 后崩溃 | batch 与 event 永久卡住 | `CLAIMED` 有租约，过期以同 batch ID 重放 |
| 外发先于登记 | 人已收到，但 Tower 没有 ask/park/mapping | 先写 `HarnessOutbound + HarnessMessage`，worker 后发送 |
| 多 runtime | `globalThis` 只能限制单进程 | 数据库 leader lease 拒绝第二个 Tower runtime |
| 单 chat 配额 | 项目或全局仍可能压垮队列 | chat/project/Workbench/global 四层 admission control |

## 租约与 fencing

每次投递包含 `generation`、随机 `leaseToken` 和 `leaseExpiresAt`。Workbench 必须在
ACK、heartbeat、resolve 中回传 token。旧终端或重放前的迟到请求会被拒绝，不能修改新一代
批次。

![Workbench 租约状态机](../diagrams/workbench-batch-state-machine.drawio.png)

[可编辑 Draw.io 源文件](../diagrams/workbench-batch-state-machine.drawio)

## 无人值守外发

![Harness Outbox 状态机](../diagrams/harness-outbox-state-machine.drawio.png)

[可编辑 Draw.io 源文件](../diagrams/harness-outbox-state-machine.drawio)

关键语义：

- `PENDING`：发送意图和 ask 已落库，但任务尚未 park；
- `DELIVERED`：平台 message id、delivery mapping、OPEN ask 和 park 已原子确认；
- `FAILED`：平台明确失败，按退避计划重试；
- `SENT_UNVERIFIED`：已有发送证据但无法完整记录，不盲目重发，保留人工确认路径。

## 运维边界

`TowerRuntimeLease` 明确约束“一份数据库只能有一个 Tower runtime”。本地单机仍然使用
SQLite，但即使误启动两个服务，也只有 leader 可以运行 Workbench、Gateway 和 Outbox
扫描器。运行健康接口会同时报告 leader、活跃批次和外发积压。

## 新增验证

- `CLAIMED` 进程退出后恢复；
- `ACKED` 处理租约过期后恢复；
- 旧 lease token 不能 ACK/resolve；
- 外发失败不提前 park；
- stale `SENDING` 不盲目重发；
- caller dedup key 保证幂等；
- 第二个 live runtime 不能取得同一数据库。

## 二次评审加固（2026-07-30）

- OWNER OpenClaw sender policy 补齐 `recover_gateway_request` 与
  `provision_remote_project`，NON_OWNER 仍只有项目只读查询能力。
- Harness outbox 将隐式内容键限定在单次 ask 生命周期：`PENDING_DELIVERY/OPEN`
  阶段重试仍去重；上一轮进入 `ANSWERED/CANCELLED/IGNORED/EXPIRED` 后，相同正文会创建
  新的发送周期。调用方显式提供的 dedup key 仍永久幂等。
- `rowResult.parked` 读取真实 ask 状态，不会把已经回答的历史 ask 报成仍在 park。
- `GatewayTaskLink` 对 inbound 和 task 增加级联外键；迁移会丢弃旧孤儿记录，恢复扫描也会
  防御性验证 task 真实存在。
- Workbench 协议明确要求未解决批次每两分钟 heartbeat，早于五分钟处理租约到期。
