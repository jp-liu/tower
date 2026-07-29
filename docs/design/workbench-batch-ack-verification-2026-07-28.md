# Workbench Batch ACK 验收记录（2026-07-28）

## 结论

Workbench 显式批次确认层已完成构建、迁移和生产运行时烟测。

最关键的验收结果是：Tower 向真实的项目常驻 Claude Workbench 投递批次后，Workbench 自动调用
新 MCP 工具完成了 `DISPATCHED → ACKED → RESOLVED`，并且 `WorkbenchEvent` 只在 ACK
事务中从 `PROCESSING` 变为 `CONSUMED`。

## 验证环境

| 项目 | 值 |
|---|---|
| 日期 | 2026-07-28 |
| 分支 | `feat/workbench-gateway-0.3.1` |
| Tower 地址 | `http://127.0.0.1:3000` |
| 数据库 | `~/.tower/database/tower.db` |
| Workbench task | `cmpqw912p000ocln5sii8gbky` |
| Workbench provider | `CLAUDE_CODE` |
| 迁移 | `0021-workbench-batch-ack` |

## 自动检查结果

| 检查 | 结果 |
|---|---|
| `pnpm exec tsc --noEmit` | 通过 |
| 目标 ESLint | 通过 |
| Coordinator + MCP 工具目标测试 | 2 个文件、40 个测试通过 |
| draw.io 总体架构图校验 | 0 error / 0 warning / 0 crossing / 0 overlap |
| draw.io 批次状态机校验 | 0 error / 0 warning / 0 crossing / 0 overlap |
| `pnpm build` | 通过 |
| 生产 schema sync | 通过 |
| `0021-workbench-batch-ack` 生产迁移 | 通过 |
| Tower 3000 / WebSocket 3001 | 启动成功 |
| Missions 页面 | HTTP 200，任务控制台与 Workbench 卡片可见 |
| 飞书 `@Tower` 全链路 | 三张卡片均回复原消息，全部通过 |

完整 Vitest 配置的 global setup 在本机仍可能遇到 Prisma CLI 的间歇性空
`Schema engine error`，错误发生在测试文件收集之前。为隔离这一既有环境问题，本轮使用不接触
生产数据库的专用临时 SQLite fixture 跑了直接相关的 40 个测试；生产 schema sync 和正式构建
均已单独通过。

## 生产运行时烟测

投递的是一个只读协议诊断：

```text
[Tower internal ACK smoke test]
This is a read-only protocol diagnostic, not user work.
Do not create a task, modify files, or send any external message.
Immediately ACK the durable batch, then resolve the same batch and end the turn.
```

真实记录：

| 字段 | 值 |
|---|---|
| `WorkbenchEvent.id` | `runtime_ack_smoke_20260728_1817` |
| `WorkbenchBatch.id` | `wb-1e10f98034fc2802f53e7539` |
| dispatch attempts | `1` |
| 最终事件状态 | `CONSUMED` |
| 最终批次状态 | `RESOLVED` |
| `lastError` | 空 |

时间顺序：

```text
DISPATCHED  2026-07-28 18:20:19.164 +08:00
ACKED       2026-07-28 18:20:29.692 +08:00
RESOLVED    2026-07-28 18:20:34.423 +08:00
```

Workbench 终端最终输出：

```text
ACK 冒烟测试完成：batch wb-1e10f98034fc2802f53e7539 已 ACKED → RESOLVED，
未创建任务、未改文件、未发外部消息。结束本轮。
```

对同一批次再次调用 ACK 和 resolve，均返回：

```json
{
  "batchId": "wb-1e10f98034fc2802f53e7539",
  "state": "RESOLVED",
  "eventCount": 1,
  "noOp": true
}
```

这证明重复确认不会重复消费。

## 飞书原线程全链路验收

在“起飞”群通过候选菜单选中真实 Tower Bot 后发送：

```text
@Tower 请在 tower 项目创建并自动启动一个临时验收任务：
只读取当前 git HEAD 短 commit id，不修改文件、不提交代码。
完成后由 Workbench 审查并将最终结果回复到本消息。
验收编号 ACK-20260728-1825。
```

飞书界面确认该源消息有 3 replies：

1. `小塔 · 已排队`，明确说明任务尚未创建；
2. `小塔 · 任务已创建`，展示真实 task id 和自动启动状态；
3. `小塔 · 任务已完成`，展示 Workbench 审查后的 `88ac423`、执行状态和只读证据。

持久化证据：

| 对象 | ID / 状态 |
|---|---|
| `GatewayInbound` | `cms4ij9ol006lcm88w731y3tb` / `PROCESSED` |
| 子任务 | `cms4ijsrz0001cmdqg2gji0tx` / `DONE` |
| 工作请求批次 | `wb-a036f961d878c32e7dc67ff6` / `RESOLVED` |
| 子任务审查批次 | `wb-920cbf5bd9fe8f6e6fb769cc` / `RESOLVED` |
| `QUEUED_ACK` | `DELIVERED` / attempts `1` |
| `TASK_CREATED` | `DELIVERED` / attempts `1` |
| `FINAL_RESULT` | `DELIVERED` / attempts `1` |

两个真实批次均只投递一次、无错误：

```text
工作请求：18:28:35 DISPATCHED → 18:28:46 ACKED → 18:29:06 RESOLVED
审查回调：18:29:16 DISPATCHED → 18:29:22 ACKED → 18:29:41 RESOLVED
```

最终结论：真实飞书、OpenClaw、Tower Gateway、生产 SQLite、常驻 Claude Workbench、
子任务回调、Workbench 审查和 GatewayDelivery outbox 的完整链路通过。
