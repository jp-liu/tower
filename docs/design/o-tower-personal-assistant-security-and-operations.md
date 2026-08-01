# o-tower 个人数字分身：安全、接入、诊断与无人值守设计

> 状态：2026-07-29 已完成安全加固与真实链路复核。本文既是架构说明，也是后续排障和扩展
> 飞书、微信、语音、Computer Operator 的基线。

## 1. 目标与非目标

### 目标

1. 机器人持有人（`OWNER`）可以通过已配置的平台私聊或可信群：
   - 查询和讨论项目；
   - 创建、修改、执行 Tower 工作；
   - 远程接入 Git 项目；
   - 诊断一条外部消息的完整链路；
   - 后续扩展仅 OWNER 可用的本机能力。
2. 同事（`NON_OWNER`）只能在可信群中查询 Tower 已登记项目的代码知识、
   项目知识和项目任务状态。
3. 陌生群、陌生私聊在进入 o-tower 之前被 OpenClaw 拒绝。
4. 外部消息、Tower 路由、Workbench、子任务和平台回执可以用同一个 trace
   关联，无须手工拼数据库和多份日志。
5. 新远程项目不猜工作区和本地根目录；缺少参数时必须向 OWNER 追问。

### 非目标

- Tower 不维护第二套 sender 账号体系，也不判断谁是 OWNER。
- 同事不能操作持有人的电脑，不能增删改 Tower，不能查询个人任务、日报或
  todo。
- `REVIEW_ONLY` 不是操作系统级沙箱。它是仓库工作流安全模式；不可信代码的
  强隔离仍需容器、虚拟机或专门的只读执行器。
- 当前版本没有接入 Computer Use。架构只保留 OWNER-only 的未来能力边界。

## 2. 核心原则：两道硬门

### 第一门：OpenClaw 身份与可信会话

OpenClaw 使用平台已经验证过的 `senderId` 和 `chatId` 做前置授权：

- OWNER 私聊：`dmPolicy=allowlist`，只有配置的 owner ID 可进入。
- 可信群：`groupPolicy=allowlist`，只有配置的群 ID 可进入，并要求真实 @。
- 陌生私聊、陌生群：在 agent 路由前丢弃或返回权限不足。
- 更新名单时，旧的 o-tower 群绑定和旧群配置会被移除，避免历史授权残留。

这道门不依赖模型理解，也不接受“我是 OWNER”之类的自然语言自报身份。

### 第二门：同一 o-tower profile 的 sender Tool Surface

OpenClaw 的 per-agent `toolsBySender` 根据平台 sender ID 决定工具集合：

| 调用者 | 工具面 | 能力 |
|---|---|---|
| OWNER | 网关路由、项目/任务查询、只读绑定解析、显式续跑、诊断 + `session_status` | 可以表达全部意图；项目写操作仍经 Workbench，只有显式续跑可幂等恢复已绑定任务 |
| 可信群 NON_OWNER | 3 个 project-reader 工具 | 项目只读讨论 |
| 其他来源 | 无 o-tower 路由 | 拒绝 |

OWNER 的“完整能力”由 **Tower Control Plane + Workbench** 提供，不等于把
`create_task`、`start_task_execution`、`delete_*` 等通用写工具暴露给消息入口。任何新建、修改、
删除、clone 或项目接入请求都必须先用 `route_gateway_message(PROJECT_WORK)` 持久化；入口拿到
`project_work` 后立即结束本轮，由绑定的项目 Workbench 独占后续写操作。唯一终端例外是
`continue_bound_task`：它只能对已解析绑定、无 OPEN ask 的任务执行显式续跑，并复用平台消息
幂等键。

这是一个硬边界，不只是提示词约定：o-tower OWNER 的 allowlist 中没有通用直接写工具。这样即使
入口模型在排队后继续推理，也无法绕开 `GatewayInbound` / `GatewayTaskLink` 再创建第二个任务。
普通回复只能调用 `resolve_gateway_task_context` 读取上下文，不能隐式恢复终端。

NON_OWNER 的三个工具是：

1. `route_gateway_query`
2. `read_gateway_project_context`
3. `complete_gateway_discussion`

这组能力从服务端结构上不能：

- 路由成 task reply；
- 创建任务；
- 启动终端；
- 排入 Workbench；
- 读取本地路径；
- 查询个人任务、日报或 todo。

Tower 只负责能力内部的项目范围和持久化事实，不再重复实现 sender RBAC。

## 3. 架构图与时序图

- 总体架构：
  [`../diagrams/o-tower-personal-assistant-target-architecture.drawio`](../diagrams/o-tower-personal-assistant-target-architecture.drawio)
  / [`PNG`](../diagrams/o-tower-personal-assistant-target-architecture.png)
- 访问、工作、回调与诊断时序：
  [`../diagrams/o-tower-access-routing-sequence.drawio`](../diagrams/o-tower-access-routing-sequence.drawio)
  / [`PNG`](../diagrams/o-tower-access-routing-sequence.png)
- Workbench 可靠网关：
  [`workbench-reliable-gateway-architecture.md`](./workbench-reliable-gateway-architecture.md)

图中有一个重要细节：OWNER 和 NON_OWNER 不是两个机器人，也不是两个
OpenClaw agent。它们是同一个 `o-tower` profile 在不同 sender 下得到的两个
工具面。

## 4. 消息工作逻辑

### 4.1 陌生群

1. 平台验证事件签名并给出稳定 `senderId/chatId`。
2. OpenClaw 检查群是否在 `trustedChannels`。
3. 不在名单：不进入 o-tower，不查询 Tower，不暴露项目是否存在。

### 4.2 可信群中的同事查询

1. OpenClaw 只暴露 project-reader 工具。
2. `route_gateway_query` 固定按 `PROJECT_DISCUSSION` 路由。
3. 项目不明确时返回候选项，模型必须追问，不能猜。
4. `read_gateway_project_context` 只接受上一步生成的 `inboundId`，从绑定项目
   读取：
   - 项目知识；
   - 最近任务状态；
   - 项目级事实。
5. 返回内容不含 `localPath`，不含个人任务、日报和 todo。
6. `complete_gateway_discussion` 将结果持久化并引用原平台消息回复。

即使同事用自然语言要求“创建任务、运行命令、修改代码”，该回合也没有相应
工具，路由能力本身也不会进入 Workbench。

### 4.3 OWNER 项目工作

1. OWNER 入口获得路由、查询、只读绑定解析、显式绑定续跑与诊断工具面，不获得通用直接写工具。
2. `route_gateway_message` 持久化外部消息并选择项目。
3. `PROJECT_WORK` 创建持久 Workbench event 和 `QUEUED_ACK` outbox。
4. o-tower 入口结束本轮，不再创建任务、不再启动终端。
5. Workbench 收到 batch 后先 `ack_workbench_batch`。
6. Workbench 调用 `create_task`，拿到真实 task ID 后才调用
   `confirm_gateway_task_created`。
7. 子任务执行结果进入 `IN_REVIEW`。
8. Workbench 审查接受后调用 `complete_gateway_work`；Tower 在同一事务中把
   任务置为 `DONE` 并创建最终回执 outbox。
9. 平台投递失败可重试；同一个语义回执不会重复发送。

### 4.4 OWNER 回复已绑定任务

1. `resolve_gateway_task_context` 只读返回任务状态、OPEN ask、项目和最近执行摘要。
2. OPEN ask 用 `reply_to_ask`；状态/结果问题只读回答；外部系统动作携带 `towerContext` 委托，均不改变任务状态。
3. 只有明确“继续/修复/重跑”才调用 `continue_bound_task`。同一平台消息已落为只读 `task_context` 时，原子升级该 `GatewayInbound`；失败或租约过期在同一行重试，并用 inbound ID 保证同一终端会话只注入一次。
4. 存在 OPEN ask 时拒绝续跑，避免绕过待回答问题。兼容工具 `relay_channel_reply` 对普通回复只返回上下文，不恢复终端。

## 5. 远程 Git 项目接入

OWNER 使用 `provision_remote_project`：

### PROVISION

必填：

- `gitUrl`
- `workspaceId`
- `localRoot`（绝对路径）

缺少任意字段时返回 `needsInput`，不选择默认值。接入流程：

1. 校验 Git URL、目标文件夹名和目录逃逸；
2. 用 `git clone -- ...` 克隆，关闭交互式凭据提示；
3. 不安装依赖，不运行仓库脚本；
4. 幂等检查同一路径或同一 origin，避免重复项目；
5. 创建 Tower Project、项目事实和常驻 Workbench；
6. 默认保存为 `REVIEW_ONLY`。

### REVIEW_ONLY 与 FULL_WORK

| 模式 | 用途 | 约束 |
|---|---|---|
| `REVIEW_ONLY` | 休假时接入陌生项目做阅读、讨论、评审报告 | Workbench 不得下发修改、安装依赖、运行仓库脚本或提交 |
| `FULL_WORK` | OWNER 明确允许正式开发 | 可创建常规工程任务；接入阶段仍不自动安装依赖或运行脚本 |

`SET_MODE` 由 OWNER 显式升级或降级。`STATUS` 返回项目和常驻 Workbench 的
持久状态。

> 安全边界说明：`REVIEW_ONLY` 当前由受管 Workbench 指令和工具流程约束，
> 能防止正常 agent 流程误写，但不是恶意代码防护。真正运行来源不可信的仓库
> 前，应另加容器/虚拟机/只读挂载。

## 6. 一条消息的统一诊断

OWNER 可以用 `diagnose_gateway_request`，传：

- Tower `inboundId`；或
- 平台 `platformMessageId`。

返回按顺序排列的六个阶段：

1. `platform_ingress`
2. `tower_route`
3. `workbench_inbox`
4. `workbench_runtime`
5. `child_task`
6. `platform_delivery`

结果同时包含：

- trace ID；
- 项目和工作区；
- Workbench event/batch/runtime；
- 子任务和最近一次执行；
- 每个 delivery 的状态、重试次数和平台 message ID；
- 第一个未完成阶段；
- 推荐动作。

`recover_gateway_request` 只恢复这一条 inbound：

- 只重试没有平台 message ID 的安全失败投递；
- 只重开这条请求对应的 Workbench 路径；
- `SENT_UNVERIFIED` 不会自动重发，因为平台可能已经收到卡片，自动重发会
  造成重复。

## 7. OpenClaw / Hermes 运行时诊断

`get_gateway_runtime_health` 提供：

- OpenClaw gateway service/RPC 状态；
- Hermes 总体状态；
- 有上限的最近 warning/error 日志；
- 按 trace 或 platform message ID 过滤；
- token、API key、secret、password 和用户主目录脱敏。

### 7.1 运行数据观测

现有六小时 Harness sweep 同时调用 Workbench 与 Gateway 各自 owner 内部的只读
观测函数。它们返回按状态行数、文本总 bytes、候选行数和候选 bytes；使用 SQLite
`length(CAST(field AS BLOB))`，不把正文带入日志。任一观测失败只记录错误，不终止
Tower，也不阻断 ask TTL sweep。

候选窗口是 Workbench `RESOLVED > 24h` 与 Gateway 终态七天。Gateway inbound
还必须没有非 `DELIVERED` delivery；delivery 必须关联仍为 `PROCESSED` 的 inbound。
2026-08-01 真实库样本的候选正文仅 70,062 bytes（数据库文件 44,924,928 bytes），
收益不足以承担永久写入路径，所以当前不压缩、不删除、不运行 `VACUUM`。

`WorkbenchEvent.payload` 始终保留作为重放输入；幂等 identity/tombstone 行也始终
保留。该观测不是隐私擦除功能，任务消息、终端/应用日志和备份有独立生命周期。

它与 `diagnose_gateway_request` 配合使用：

- Tower 链路停在 `platform_ingress` 之前：看平台/OpenClaw；
- 停在 `workbench_*`：看 Tower Workbench；
- Tower 全部完成但 `platform_delivery` 失败：看 OpenClaw/Hermes 投递。

## 8. 配置

设置页的 OpenClaw Tower Agent 配置新增：

- OWNER IDs：每行 `platform:id`
- Trusted Channels：每行 `platform:chatId`

等价配置示例：

```json
{
  "harness.gatewayConfig": {
    "openclaw": {
      "profile": "o-tower",
      "displayName": "小塔",
      "accessPolicy": {
        "ownerIds": {
          "feishu": ["ou_xxx"]
        },
        "trustedChannels": {
          "feishu": ["oc_xxx"]
        }
      }
    }
  }
}
```

更新 Tower Agent 后必须：

```bash
openclaw gateway restart
openclaw gateway status
openclaw status --all
```

然后在每个受影响飞书会话发送一条独立的 `/new`，让活跃会话重新加载 profile
和工具策略。

## 9. 验收表

| 场景 | 操作 | 预期 |
|---|---|---|
| 陌生私聊 | 非 OWNER 私聊机器人 | 不进入 o-tower / 权限不足 |
| 陌生群 | 将机器人拉入未配置群并 @ | 不进入 o-tower / 权限不足 |
| 可信群同事查询 | @机器人询问绑定项目 | 引用回复项目答案，无本地路径 |
| 可信群同事越权 | 要求创建任务/运行命令/改代码 | 拒绝；无任务、无终端、无 Workbench event |
| OWNER 查询 | 私聊查询 Tower | 正常返回 |
| OWNER 工作 | 创建并自动启动一项小任务 | 依次出现排队、真实创建、审查后完成 |
| OWNER 入口越界 | 排队后入口尝试直接 `create_task` / 启终端 | 工具不存在；只能由 Workbench 创建一次 |
| 远程项目缺参数 | 只给 Git URL | 追问 workspace 和 localRoot |
| 远程项目接入 | 给齐三项 | clone、登记、Workbench 创建，默认 REVIEW_ONLY |
| 单条诊断 | “诊断这条消息” | 返回六阶段时间线和首个未完成阶段 |
| 安全恢复 | 对 FAILED 请求恢复 | 只恢复该 inbound，不重复已发送卡片 |

## 10. 后续扩展顺序

1. 先稳定使用当前文本渠道和诊断闭环。
2. 增加 OWNER-only Computer Operator，但只提供可观察、可审计的高层动作，
   不把裸 GUI 控制开放给同事。
3. 为不可信仓库增加真正隔离的 REVIEW_ONLY executor。
4. 语音入口只做新的平台适配器：语音转文字后仍经过同一身份、可信会话和
   Tool Surface；回复再按需 TTS。

## 11. 生产验收记录（2026-07-29）

本轮已完成以下检查：

| 检查 | 结果 |
|---|---|
| TypeScript | `pnpm exec tsc --noEmit` 通过 |
| 完整测试 | 229 个文件通过、6 个按设计跳过；2127 个测试通过、27 个 TODO |
| 生产构建 | `pnpm build` 通过 |
| 数据迁移 | `0023-project-access-mode` 已执行 |
| Tower 服务 | `127.0.0.1:3000` 正常监听 |
| OpenClaw | 配置有效、RPC 正常、飞书 webhook 正常监听 |
| OWNER 真实群聊查询 | 真实 `@Tower` 后引用原消息返回 tower 最近 3 个任务标题 |
| 查询副作用 | 请求前后 Task 总数均为 817；未创建任务、未启动终端 |
| 讨论真实链路 | `E2E-DISCUSS-20260729-1430` 引用回复成功且没有创建任务 |

第二次真实工作链路 `E2E-WORK-20260729-1433` 在加固前抓到一个重要缺陷：入口已经把请求排入
Workbench 后，仍可调用直接建任务工具；它在 Workbench 已创建并完成幂等任务后，又省略
`gatewayInboundId` 创建了第二个任务。修复内容：

1. OWNER ingress allowlist 移除通用直接写工具，仅保留受约束的显式 `continue_bound_task`；
2. group system prompt 明确写操作只能路由为 `PROJECT_WORK`，返回后必须结束本轮；
3. Tower 保留 Workbench 侧的 `gatewayInboundId + GatewayTaskLink` 幂等恢复；
4. 增加 sender/chat 速率限制和 trusted-channel 队列硬上限；
5. 增加工具策略和限流自动测试。

误建的第二个验收执行已停止并保留为 `IN_REVIEW` 证据，没有删除审计数据。该问题的发现说明
真实平台测试不是装饰性步骤；最终验收必须同时核对飞书卡片、GatewayInbound、GatewayTaskLink、
Task 与 TaskExecution，不能只看“收到回复”。

真实验收消息标记：

```text
OWNER-ACCESS-20260729-1130
```

OpenClaw 日志确认该消息来自已配置 OWNER 和可信群，进入
`agent:o-tower:feishu:group:<trusted-chat>`；飞书端收到引用回复。

以下边界没有冒用他人身份做生产破坏性验证：

- 非 OWNER 在可信群只能查询绑定项目；
- 未知群和未知私聊不会进入 o-tower；
- 非 OWNER 请求任务、终端、远程项目接入时没有对应工具可调用。

这些边界已由安装配置审计和自动测试覆盖。以后具备专用测试账号时，可按第 9 节验收表补做
真人黑盒验证。

当前还存在两项非阻断运行告警：

1. 飞书应用缺少 contact readonly scope，OpenClaw 当前会忽略这条旧兼容查询失败；消息接收、
   真实提及和回复均已验证正常。
2. OpenClaw 的 `plugins.allow` 为空且
   `gateway.controlUi.allowInsecureAuth=true`。它们不是本轮权限路由的实现内容，但在准备把
   gateway 暴露到非本机网络前必须单独收紧。
