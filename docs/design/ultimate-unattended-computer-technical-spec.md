# Tower 模块边界与终极无人值守首个增量 Technical Spec

> 状态：最终版；首个增量已实现并通过本地与 PR CI 验证
> 定稿日期：2026-08-02
> 回滚基线：`40cdf1a`
> 上位章程：[`ultimate-unattended-computer-charter.md`](./ultimate-unattended-computer-charter.md)
> 架构图解：[`ultimate-unattended-computer-architecture.md`](./ultimate-unattended-computer-architecture.md)

## 1. 目标

本增量同时推进两件事，但不把长期目标伪装成一次完成：

1. 在同一仓库、同一进程和同一 SQLite 数据库内收口 Tower 模块边界；
2. 复用 OpenClaw 原生 Task 状态，补上外部 Capability Job 的只读恢复查询。

验收重点不是“目录看起来分开”，而是状态所有权和依赖方向改变：Core 不再直接拥有 unattended 运行态，
Gateway 适配不向 Core 注入 OpenClaw 状态机，执行/任务状态变化只向 Goal 模块报告生命周期事实。

## 2. 明确不做

- 不拆 npm 包、服务、进程或数据库；
- 不创建新的 Capability Registry、Job 系统或通用 Event Bus；
- 不在 Tower 保存 OpenClaw 凭据、具体 Operator 路由或完整 Job 状态机；
- 不实现尚未核验的通用 R2/R3 授权签发器；
- 不把 `set_goal_mode` 当作外部副作用授权；
- 不自动重试 `SIDE_EFFECT_UNKNOWN`；
- 不修改用户本机 `~/.openclaw` 配置；
- 不宣称通用 discovery、确定性 Job 提交和跨系统 completion event 已完成。

## 3. 模块边界

| 模块 | 拥有 | 可以依赖 | 禁止拥有 |
|---|---|---|---|
| Core | Workspace、Project、Task、Record/Note、Review | 通用基础设施 | 渠道凭据、Operator 路由、无人值守策略、外部 Job 状态机 |
| Execution / Terminal | PTY、Provider、TaskExecution、终端生命周期 | Core application port | Gateway 路由、Goal 策略 |
| Workbench | Batch/Event/Runtime、lease/fencing、ACK/resolve | Core ID、Execution 边界 | Goal 预算和外部渠道 |
| Gateway | inbound/delivery/ask/reply、OpenClaw 适配 | Core application port、Workbench handoff | 项目真相、Goal reducer |
| Unattended Goal | 运行态、生命周期 reducer；后续唤醒/预算策略 | Core task ID、Gateway 可用性、生命周期事实 | Operator 路由、平台凭据、PTY 实现 |

当前物理目录仍是渐进式的。新增边界代码分别进入 `src/lib/unattended-goal/`、`src/lib/gateway/` 和对应
MCP tool 文件；既有大文件不为追求目录纯度做一次性搬迁。

## 4. Unattended Goal 运行态

### 4.1 权威投影

新增 `UnattendedGoalRuntime`：

| 字段 | 语义 |
|---|---|
| `taskId` | Core Task 的不透明引用，也是模块主键 |
| `state` | `ACTIVE` / `ENDED` |
| `lastEventKind` | 最近一次权威生命周期事实 |
| `activatedAt` | 本轮无人值守激活时间 |
| `endedAt` | 本轮结束时间 |
| `updatedAt` | 投影 revision 时间 |

该模型故意不声明 Prisma relation。删除 Task 时由迁移创建的 SQLite trigger 清理投影；这样既保持同库
数据完整性，又不让 Core schema 反向拥有可选模块。

### 4.2 一轮兼容窗口

`Task.unattended` 暂不删除，作为回滚到 `40cdf1a` 的兼容影子：

- 迁移把历史 `Task.unattended = true` 回填为 `ACTIVE / LEGACY_BACKFILL`；
- 新写入在一个事务内更新模块投影与兼容影子；
- 读取优先模块投影，仅当投影不存在时回退旧字段；
- standalone PreToolUse hook 继续读取 signal file，该文件只是模块投影的进程外镜像；
- 下一个兼容窗口确认无回滚需求后，才单独评审移除旧字段和 fallback。

### 4.3 生命周期入口

`src/lib/unattended-goal/runtime.ts` 是唯一状态入口。当前事件：

- `ACTIVATED`
- `DEACTIVATED`
- `TASK_LEFT_ACTIVE_LOOP`
- `TERMINAL_STOPPED`
- `TERMINAL_COMPLETED`

Task action、Terminal action 和 MCP tool 不再直接写 `Task.unattended`。生产者只报告事实，由 Goal 模块
决定投影结果。普通 attended 任务结束时不创建无意义的 `ENDED` 行。

### 4.4 激活门禁

`set_goal_mode(on=true)` 仅在存在 active `openclaw` / `hermes` unattended target 时成功。原因是产品定义
要求“没有 Gateway 就没有无人值守 Goal”；关闭操作即使 Gateway 已离线也必须可用。

工具返回 `authorizationGranted: false`。它只记录运行承诺，不授予外部写、发布、删除、权限或系统设置。
R2/R3 缺少可信限域 `authorizationRef` 时必须 `BLOCKED` 并询问 OWNER。

## 5. MCP 能力面

`src/mcp/tool-capabilities.ts` 按责任拆出两个原子组：

| group | tool | profile |
|---|---|---|
| `unattendedGoal` | `set_goal_mode` | `full`, `task` |
| `gatewayCapability` | `get_capability_job_status` | `full`, `task` |

Assistant 只保留 Core + Terminal，不得到无人值守或 Gateway 工具。`task` profile 能在已配置扩展时启用
Goal 和外部恢复；运行时配置门禁负责 fail-closed。此次不增加动态 MCP catalog，以免把模块开关扩成新的
插件系统。

## 6. OpenClaw Job 只读对账

### 6.1 原生能力证据

2026-08-01 在 OpenClaw `2026.7.1-2` 上完成无副作用探针：

- `openclaw agent --agent o-tower --session-key ... --json` 成功返回 run；
- run 最终输出 `TOWER_CAPABILITY_JOB_OK`；
- `openclaw tasks show <runId> --json` 返回持久 Task，状态为 `succeeded`；
- 返回值包含 `taskId`、`runId`、`status` 与 `lastEventAt`。

因此恢复查询直接包装 `openclaw tasks show`，不在 Tower 新建外部 Job 表。

### 6.2 只读契约

`get_capability_job_status({ gateway: "openclaw", jobRef })`：

- 接受 OpenClaw `taskId` 或 `runId`；
- `execFile` 以参数数组调用 CLI，不经过 shell；
- ref 只允许 1–256 个字母、数字、`:`、`.`、`_`、`-`；
- 20 秒超时、1 MiB 输出上限；
- 只返回安全摘要，不透传 task prompt、session key 或完整上下文；
- 不创建、恢复、取消、重试或修改 OpenClaw Task。

标准化映射：

| OpenClaw | Tower capability result |
|---|---|
| `queued` | `ACCEPTED` |
| `running` | `RUNNING` |
| `succeeded` | `SUCCEEDED` |
| `failed` | `FAILED` |
| `cancelled` | `CANCELLED` |
| `timed_out` | `EXPIRED` |
| `lost`、未知值 | `SIDE_EFFECT_UNKNOWN` |

`revision` 当前取 OpenClaw `lastEventAt`，回退 `endedAt / startedAt / createdAt`。缺少权威时间戳时拒绝
构造结果，避免用本地查询时间伪造 revision。`lost` 或未来未知状态可能已经产生外部副作用，因此保守进入
`SIDE_EFFECT_UNKNOWN`，绝不自动重放。

## 7. Bridge 与授权语义

`tower-bridge` 只负责外部 capability：

- 真人消息继续使用 `tower-ask`；
- Tower sibling task 继续使用 Tower 的 `resume_task_execution` / `send_task_terminal_input`；
- 外部请求使用版本化 `CapabilityRequest` envelope；
- 请求表达 capability、输入、风险和期望结果，不写具体 Agent；
- 每个 `requestId` 只选一条执行路径；已接受或副作用未知时禁止回退旧路径重发。

当前 envelope 先作为 Skill 契约存在。没有稳定的非 LLM 提交入口之前，不新增只被测试消费的 TypeScript
`CapabilityClient` 抽象。后续入口确认后再让 schema 成为可执行边界。

## 8. 数据与清理

- `UnattendedGoalRuntime` 是长期运行态，Task 删除时同步清理；结束记录暂保留用于诊断；
- Gateway inbound/delivery 生命周期继续使用现有压缩和维护机制，本增量不新增定时器；
- OpenClaw Job 的详细保留与清理归 OpenClaw；Tower 只在未来保存项目所需的 `requestId/jobRef` 关联和摘要；
- 双方不共享数据库，也不直接写对方表。

## 9. 验证门禁

### 9.1 自动化

- migration：回填、重复执行、Task 删除 trigger；
- reducer：旧字段 fallback、模块投影优先、激活事务、普通任务不产生 ended 行；
- tool：无 Gateway 激活失败、配置存在时成功、Gateway 离线仍可关闭；
- catalog：工具唯一分组、profile 边界与历史 full surface；
- reconciliation：状态映射、revision、敏感字段不透传、缺失 revision 拒绝；
- harness：模块投影覆盖兼容影子，并正确决定 work/unattended scope；
- 全量 Vitest、TypeScript、ESLint、MCP build、Next production build。

### 9.2 本机集成

- OpenClaw 无副作用 run/task 探针；
- `tasks show` 用 runId 查询成功；
- 不修改 OpenClaw 路由和凭据；
- draw.io XML 0 error / 0 warning，四页 PNG 完成两轮视觉自检。

## 10. 后续阶段

按下面顺序继续，每一步都先复用原生能力：

1. 核验并定义 discovery 的 capability/schema/schemaRef/health 输出；
2. 为 OWNER home-route Direct 消息补齐可信一次性授权或限域 unattended grant；
3. 确认稳定的非 LLM Job 提交入口，无法满足时才做 OpenClaw 薄插件；
4. 将 completion event 作为主路径接入 Workbench/Goal durable inbox；
5. 保存最小 `requestId/jobRef/revision` 关联，使用本增量查询工具做低频恢复；
6. 再实现 Goal 持久 timer、预算和 watchdog；
7. 用一个真实 Operator 做故障注入和重启 E2E；
8. 只有独立发布或部署收益明确时，评审拆包/拆库。

## 11. 完成定义

本增量完成不等于“终极无人值守电脑完成”。完成只表示：

- Tower 模块边界已经有可执行所有权，不只是文档命名；
- 没有 Gateway 时无法激活 unattended Goal；
- Goal 状态不再由 Core Task 直接写入；
- 外部 Job 恢复查询复用 OpenClaw 权威状态且不会产生副作用；
- bridge 不再把本机 Operator 映射写死在 Tower；
- 迁移、回滚兼容、单元测试、全量构建和图文已经同步。
