# Tower 模块边界与终极无人值守纵向闭环 Technical Spec

> 状态：实现候选版；自动化门禁已完成，本地 UI 持久化闭环与真实 Operator 故障注入待交叉验收
> 更新日期：2026-08-02
> 回滚基线：`40cdf1a`
> 上位章程：[`ultimate-unattended-computer-charter.md`](./ultimate-unattended-computer-charter.md)
> 架构图解：[`ultimate-unattended-computer-architecture.md`](./ultimate-unattended-computer-architecture.md)
> 验收方案：[`ultimate-unattended-computer-acceptance.md`](./ultimate-unattended-computer-acceptance.md)

## 1. 本次交付

本次交付在同一仓库、发布包和 SQLite 内完成一个可执行纵向闭环：

1. Tower Core、Execution、Workbench、Gateway/Capability、Unattended Goal 形成明确状态所有权；
2. Tower UI 为一个 Goal 签发限时、限次数、限 capability 和限目标版本的 R2/R3 grant；
3. task agent 通过版本化 `CapabilityRequest` 使用固定 OWNER Direct 消息或 OpenClaw Operator Job；
4. OpenClaw Job 完成后回调 Tower，Tower再读取 OpenClaw 权威状态并幂等唤醒 Workbench；
5. 回调丢失或进程重启时，低频扫描按 `jobRef` 只读对账；
6. Goal 用持久 timer、预算、进展事实和 watchdog 决定继续、等待或阻塞。

“纵向闭环完成”不等于所有外部软件、渠道和 Operator 都已适配。更多 capability 只应增加 OpenClaw
配置和 schema，不应扩张 Tower Core 模型。

## 2. 明确不做

- 不拆 npm 包、服务、进程或数据库；
- 不创建第二套 Capability Registry、通用 Job 系统或通用 Event Bus；
- 不在 Tower 保存 OpenClaw 凭据、具体 Operator `agentId` 或完整 Job 状态机；
- 不让 Agent 通过 Goal 文本、`set_goal_mode` 或自填字段获得 R2/R3 授权；
- 不允许调用方指定 unattended OWNER 的真实渠道目标；
- 不自动重试 `SIDE_EFFECT_UNKNOWN`；
- 不高频轮询 OpenClaw Job；
- 不在安装或测试期间自动修改用户已有 OpenClaw Operator 映射。

## 3. 模块与依赖方向

| 模块 | 权威拥有 | 对外边界 | 禁止拥有 |
|---|---|---|---|
| Core | Workspace、Project、Task、Version、Note/Asset、Review | Core ID 和应用 action | 渠道凭据、外部路由、Goal 策略 |
| Execution / Terminal | PTY、Provider、TaskExecution、回合完成事实 | lifecycle notification | Gateway 路由、Goal reducer |
| Workbench | Event、Batch、Runtime、lease/fencing、ACK/resolve | durable command/result | Goal 预算、外部凭据 |
| Gateway / Capability | inbound/delivery/ask/reply、discovery/schema、grant、request/result correlation | `CapabilityRequest`、completion、read-only reconciliation | 项目真相、Goal 调度 |
| Unattended Goal | runtime projection、timer、预算、watchdog、progress facts | lifecycle reducer、operation guard、Workbench wakeup | Operator 路由、平台凭据、PTY 实现 |

模块仍共享 Prisma Client 和 SQLite，但共享数据库不授权跨模块直接读写。跨边界只传 Core ID、版本化契约
和持久生命周期事实。`src/lib/workbench/event-contract.ts` 是可共享的事件类型与事务持久化原语，不包含
调度器；真正的 Workbench coordinator 仍是 server-only。

## 4. 数据模型与迁移

### 4.1 Goal 投影

`UnattendedGoalRuntime` 是 Goal 的权威运行态，状态为 `ACTIVE / BLOCKED / ENDED`。它持久化：

- 激活、阻塞、结束时间和最近生命周期事实；
- provider turn、连续失败、无进展轮次；
- duration、child、concurrency、capability Job、token、cost 等预算；
- `nextWakeAt`、wake reason/generation/published marker；
- block reason/generation/published marker。

`UnattendedGoalProgressFact` 用唯一 `dedupKey` 记录 provider turn、child 和 capability Job 的成功/失败事实。
`Task.unattended` 暂时作为一轮回滚兼容影子，新写入始终由 Goal reducer 双写；Task 删除由 SQLite trigger
清理无 Prisma relation 的 Goal 投影。

### 4.2 Capability 数据

`CapabilityGrant` 保存 UI 签发的限域授权：task、capability、risk、target kind/fingerprint、过期时间、
`maxUses/usedCount` 和撤销时间。

`CapabilityRequest` 保存最小恢复关联：

- `requestId`、task、schema version、capability、lane、risk；
- authorization ref、输入摘要和冻结后的输入；
- Gateway、`jobRef`、state、revision；
- result summary、evidence refs、last error；
- Workbench result published marker；
- completion callback token 的 SHA-256 hash，终态后清空。

Tower 不保存 OpenClaw prompt、session key、Operator id、完整日志或凭据。

### 4.3 迁移顺序

| Migration | 内容 |
|---|---|
| `0029-unattended-goal-runtime` | Goal 投影、legacy backfill、Task delete trigger |
| `0030-capability-runtime` | grant、request、状态枚举与索引 |
| `0031-capability-result-wakeup` | Workbench capability result kind 与发布 marker |
| `0032-unattended-goal-policy` | BLOCKED、预算、timer、progress facts |
| `0033-capability-completion-callback` | 限域 completion callback token hash |

所有迁移幂等，并由 release package canary 强制进入 npm 包。

## 5. Capability 契约

### 5.1 Discovery

`discover_gateway_capabilities` 返回：

- contract `schemaVersion`；
- capability、lane、risk、availability 和安全描述；
- 完整 input/output JSON schema；
- route revision；
- 当前 task 可用 grant 的 opaque ref、过期时间和剩余次数。

Discovery 不返回 OWNER destination、Operator `agentId`、凭据或底层命令。Tower 和 OpenClaw 都在边界处
按同一 schema 校验；输入不合法时在消费 grant 前 fail-fast。

### 5.2 Direct lane

首个 Direct capability 是 `human.message.send`：

- 只能发往已配置的 unattended OWNER home route；
- 调用方不能提交 destination；
- R2 grant 在 request 首次接受时原子消费；
- `requestId` 重用返回同一结果，payload 变化被拒绝；
- 平台确认送达为 `SUCCEEDED`；可能已送达但无法确认时为 `SIDE_EFFECT_UNKNOWN`；
- 成功后复用既有 ask/park 生命周期，不能再重复调用 `push_to_human`。

### 5.3 Job lane

OpenClaw 插件在自己的配置中维护 capability -> Operator `agentId`、risk 和 schema。Tower 只提交业务
capability 和最小输入。插件以 `tower-capability:<requestId>` 作为 OpenClaw 原生幂等 key，立即返回
`ACCEPTED + runId`；具体路由从不返回 Tower。

Job 创建前必须通过 Goal 预算守卫。Goal `BLOCKED` 后不再接受新 Job；`BLOCKED` 只保留一次或有限次数的
OWNER Direct 通知能力。Goal `ENDED` 后旧 grant 不再 discovery，也不能创建任何新 R2/R3 请求。已经接受
的 request 不因 grant 后续过期或撤销而丢失，仍按原 `requestId` 恢复。

## 6. 完成、恢复与乱序

OpenClaw `subagent_ended` hook 只回传 `requestId + runId`，不自报成功结果。回调 bearer token 每个 Job
随机生成，Tower 只存 hash，且 URL 必须是 localhost 固定 completion path。Tower 验证 token 后调用
`openclaw tasks show <jobRef> --json` 获取权威状态、revision 和时间戳。

完成结果进入 Workbench `CAPABILITY_RESULT_AVAILABLE`，dedup key 为 `requestId + revision`。写入终态使用
条件更新，迟到的 `RUNNING` 不能覆盖终态。极快 Job 若在 submit response 持久化前完成，回调处理会先用
相同幂等 key 修复 `jobRef`，随后立即只读对账，不等待扫描。

60 秒恢复扫描只处理：

- `PENDING / ACCEPTED / RUNNING` 请求；
- 已终态但 Workbench result marker 尚未写入的请求。

扫描不猜测结果，不自动重放未知副作用。completion callback 是主路径，扫描只是重启和丢回调安全网。

## 7. Goal 循环

Goal 的安全循环是：

```text
持久事件/timer 到期 -> Workbench claim -> provider turn
-> provider-confirmed completion -> ACK/resolve 或新的等待事实
-> 预算/进展评估 -> ACTIVE / BLOCKED / ENDED
```

唤醒来源包括 child result、Gateway result、OWNER reply、Capability Job result 和持久 timer。终端静默不是
完成、失败或安全注入条件。

预算在创建 child、启动 child、提交 capability Job、provider turn 完成和 15 秒 watchdog 扫描时执行。
达到 duration、turn、child、concurrency、连续失败、无进展或 Job 上限时，Goal 原子进入 `BLOCKED`，并向
Workbench 写入一次 `GOAL_BLOCKED`。timer 到期同样在一个事务内写 `GOAL_TIMER_DUE` 和 published marker，
避免 Goal 结束后迟到发布。

## 8. 安全和失败规则

1. grant 只能由可信 Tower UI 签发，issuer 固定为 `TOWER_UI`；
2. R2/R3 grant 与 task、capability、risk、target fingerprint、有效期和次数绑定；
3. `set_goal_mode` 只写运行态，永远返回 `authorizationGranted: false`；
4. Direct destination 和 Job Operator 都不由模型选择；
5. callback 只接受 localhost 固定路径和至少 32 字节随机 token；
6. schema 在 Tower 和 OpenClaw 各校验一次；
7. `SIDE_EFFECT_UNKNOWN` 是终态，禁止自动 retry/fallback；
8. 每个请求只走一条执行路径，迁移期不得新旧双执行。

## 9. 交付与配置

Tower Agent 安装器会把 `openclaw-capability` 插件复制到 OpenClaw extensions 并启用 entry。若用户已有
`plugins.allow`，只追加 Tower plugin id；若没有 allowlist，不主动创建，避免意外禁用其他已发现插件。
卸载时只删除 Tower 管理的 agent、workspace、plugin entry 和 allowlist 成员。

Operator capability 由用户在 OpenClaw plugin config 中显式配置。空配置合法，只会 discovery 到 OWNER
Direct；Tower 不猜测 `computer-operator`、`xiao-fei` 或任何同事机器上的 agent 名。

## 10. 验证与剩余门禁

已完成的自动化和本机验证：

- Prisma generate、TypeScript、ESLint、MCP bundle、Next production build；
- capability contract/runtime/migration、Goal runtime/policy/migration、Workbench、PTY lifecycle、callback
  route、installer/plugin 单元测试；
- 请求去重、grant 消费、Goal 结束后旧 grant、BLOCKED OWNER 通知、终态乱序、submit/callback 竞态、
  timer/end 竞态和 Workbench durable result 测试；
- npm package canary，包含 0030-0033 和 OpenClaw plugin 文件；
- OpenClaw `2026.7.1-2` 实际加载插件，`plugins inspect` 为 loaded，`plugins doctor` 无问题；
- 全量 Vitest：255 个文件通过、6 个文件跳过，2266 条测试通过、27 条 todo；
- draw.io 四页源文件校验通过；当前 Tower 架构页为 0 crossing、0 overlap、0 through-vertex，导出图已完成视觉检查。

代码合并仍以分支自 review 和 PR CI 为工程门禁，不作为本协议额外引入的运行时机制。

部署后第一项工作不是增加更多抽象，而是配置一个真实、低风险 Operator 做故障注入 E2E：正常完成、
Tower 重启、OpenClaw 重启、回调丢失、迟到 RUNNING、取消/超时和 `SIDE_EFFECT_UNKNOWN`。该 E2E 不改变
本 spec 的模块边界；失败时只修薄适配、状态映射或部署配置。
