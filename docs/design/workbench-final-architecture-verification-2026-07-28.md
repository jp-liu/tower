# Workbench 最终架构验收记录（2026-07-28）

## 结论

Workbench 可靠网关五个阶段已全部落地并通过自动测试、生产构建、生产迁移、Missions
可观测性检查和真实飞书原线程验收。

本轮最关键的新增保证是：

1. Workbench 审查通过后直接调用 `complete_gateway_work`；
2. 同一个 SQLite 事务同时写入 `Task=DONE` 和
   `GatewayDelivery(kind=FINAL_RESULT,state=PENDING)`；
3. 飞书发送发生在事务提交之后，失败只改变 delivery 的重试状态，不会再丢失最终回执；
4. `WorkbenchRuntime` 持久显示 generation、heartbeat、当前批次、积压和阻塞原因；
5. Missions 卡片把这份运行状态投影为可见的运维徽标。

主架构说明见
[`workbench-reliable-gateway-architecture.md`](workbench-reliable-gateway-architecture.md)，
可编辑架构图见
[`../diagrams/workbench-reliable-architecture.drawio`](../diagrams/workbench-reliable-architecture.drawio)。
全链路时序图见
[`../diagrams/workbench-gateway-sequence.drawio`](../diagrams/workbench-gateway-sequence.drawio)，
批次状态机见
[`../diagrams/workbench-batch-state-machine.drawio`](../diagrams/workbench-batch-state-machine.drawio)。

## 自动检查

| 检查 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | 通过 |
| 目标 ESLint | 通过 |
| Coordinator + Gateway + MCP 目标测试 | 3 个文件、69 个测试通过 |
| 完整 Vitest 回归 | 227 个文件通过、6 个按设计跳过；2121 个测试通过、27 个 TODO；0 失败 |
| 平台发送失败原子性用例 | 通过：任务 `DONE`，`FINAL_RESULT` 保持 `FAILED` 可重试 |
| `pnpm build` | 通过 |
| 生产 schema sync | 通过 |
| `0022-workbench-runtime` 迁移 | 通过 |
| 总体架构图严格校验 | 0 error / 0 warning / 0 crossing / 0 overlap |
| 全链路时序图严格校验 | 0 error / 0 warning / 0 crossing / 0 overlap |
| Tower HTTP / WebSocket | `127.0.0.1:3000` / `3001` 启动成功 |
| Missions | HTTP 200，Workbench 健康徽标真实渲染 |

测试 global setup 和两个迁移矩阵夹具曾因 Prisma 6 在嵌套目录尚未创建 SQLite 文件时只返回空
`Schema engine error`；另一个历史迁移夹具错误地使用当前完整 Prisma model 读取只迁移到
`0015` 的数据库。本轮统一在安全的临时目录中预创建空数据库文件，并让历史夹具只查询其
当时真实存在的列。完整测试集现已稳定通过，且不会访问生产数据库。

## Missions 运行态验收

生产 `WorkbenchRuntime`：

| 字段 | 验收值 |
|---|---|
| taskId | `cmpqw912p000ocln5sii8gbky` |
| generation | `1` |
| executionId | `cms49cmjg000fcmbtj7ee4icg` |
| 最终 state | `IDLE` |
| pendingEvents | `0` |
| activeBatchId | 空 |
| blockedReason | 空 |
| lastError | 空 |

真实 Missions DOM 和页面截图均显示 `G1 · BUSY`（处理时），悬停文本包含：

```text
Workbench generation 1
state=BUSY
pending=0
Provider turn in progress
heartbeat=<持续刷新时间>
```

批次完成后数据库投影自动恢复为 `IDLE`，证明 UI 显示的数据来自持久运行态，而不是根据终端
是否有输出进行猜测。

## 真实飞书原子完成验收

在“起飞”群中通过 `@` 候选菜单选中真实 Tower Bot，发送：

```text
In tower project create and auto-start one read-only task.
Run git rev-parse --short HEAD only.
Do not modify files or commit.
After the child stops in IN_REVIEW, DO NOT call move_task(DONE).
Workbench must call complete_gateway_work directly;
it owns atomic DONE plus FINAL_RESULT.
Reply here. Marker ATOMIC-20260728-1906.
```

飞书源消息显示 3 replies：

1. `小塔 · 已排队`
2. `小塔 · 任务已创建`
3. `小塔 · 任务已完成`

持久化证据：

| 对象 | ID / 结果 |
|---|---|
| `GatewayInbound` | `cms4jxcpd007fcmrkva69v96x` / `PROCESSED` |
| 子任务 | `cms4jy25n0006cmy0wlf9jcpj` / `DONE` |
| 工作请求批次 | `wb-a651fdeea0060ebdd43a5054` / `RESOLVED` |
| 审查批次 | `wb-8c2495377a6f8ef24d05439f` / `RESOLVED` |
| `QUEUED_ACK` | `DELIVERED` / attempts `1` |
| `TASK_CREATED` | `DELIVERED` / attempts `1` |
| `FINAL_RESULT` | `DELIVERED` / attempts `1` |

原子边界时间：

```text
Task.doneAt                  2026-07-28T11:08:38.712Z
FINAL_RESULT.createdAt       2026-07-28T11:08:38.714Z
FINAL_RESULT.deliveredAt     2026-07-28T11:08:39.898Z
```

Task 与 outbox 的时间只差 SQLite 在同一事务内执行后续 insert 的 2 ms；平台发送在事务提交后
约 1.18 秒完成。最终 delivery 的回执字段为：

```text
platformParentId = om_x100b69bc9b4730a0386df383a0f0923
platformMessageType = interactive
attempts = 1
```

飞书最终卡片和 Workbench 结果都明确记录：

```text
未调用 move_task(DONE)，由 complete_gateway_work 原子完成 DONE + FINAL_RESULT。
```

## 语义边界

数据库内已经消除了 `DONE` 与最终 outbox 之间的崩溃窗口。外部飞书传输仍是符合现实约束的
at-least-once + 幂等语义：

- 有完整平台回执时标记 `DELIVERED`；
- 没有发送证据时标记 `FAILED` 并重试；
- 已拿到 message id、但引用/卡片契约无法验证时标记 `SENT_UNVERIFIED`，停止自动重试，
  避免制造重复卡片。

因此这里不宣称飞书 API 无法证明的严格 exactly-once，但 Tower 自身的业务状态已经可恢复、
可审计、可观察。
