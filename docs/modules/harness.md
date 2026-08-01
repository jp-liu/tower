---
title: Harness 模块
description: 无人值守消息体系 + 父子任务通信 + 卡住升级阶梯 —— Tower 作为「登记 + 挂起 + 回灌」的胶水
---

**Slug:** `harness`

## 功能介绍

Harness 是 Tower 的**无人值守协作体系**。当任务长时间自主运行（L2 无人值守），或被父任务派生出来跑一个子目标时，Agent 需要在**被卡住、要决策、要报进展**时联系到能拿主意的人；对方拿了主意，任务要能被唤醒继续。这套「联系上级 → 挂起 → 回灌唤醒」的能力就是 Harness。

它由三块拼成，前后连成一条链：

1. **中继消息**：Agent 发消息给人 / 收人回复，收发外包给外部网关（[中继架构](#中继架构)）。
2. **父子任务通信**：被派生的子任务卡住时，不直接打扰人，先回推**父任务**定夺（[父子任务派生](#父子任务派生)）。
3. **卡住升级阶梯**：一套「谁在盯这个终端 → 该找谁」的判定，把原生阻塞式问答（`AskUserQuestion` 菜单）在无人盯守的终端上**硬禁**掉，逼着走 子→父→人 的上报路（[卡住升级阶梯](#卡住升级阶梯引导--硬禁)）。

核心设计是**中继模型**：

- **Tower 自己不接飞书/微信，也不直接发消息**（旧的内置 SDK 发送栈已删除）。
- 真正的收发外包给**外部网关 Hermes / OpenClaw**（独立仓库 / 外部服务）。
- Tower 负责**登记问题、显式 park/resume、持久化项目会话、可靠排队与出站重试**；网关负责平台 transport、首跳意图分类和外部能力委派。
- 旧 ask/task 回复继续靠 `[[tower:task=<id>]]` 与投递映射；普通项目消息由 Tower 保存 platform/chat/thread/root message ↔ project 会话绑定。

> **配套图**（`docs/diagrams/` 下自包含 HTML，可独立打开）：
> - 无人值守消息中继：`docs/diagrams/tower-harness-flow.html`（EN：`-en.html`）
> - 父子通信 + 升级阶梯：`docs/diagrams/tower-escalation-ladder.html`（EN：`-en.html`）

## 详细说明

### 中继架构

```
Task Agent (MCP 工具)
   │  push_to_human / ask_human / notify_human
   ▼
Tower（登记 + park/resume，只记录不直连平台）
   │  push_to_human 经网关 CLI 出站
   ▼
外部网关 Hermes / OpenClaw ──► 飞书 / 微信 / …
   ▲
   │  人的回复（携带 [[tower:task=<id>]] token）
   ▼
reply_to_ask ──► 回答 OPEN ask，resume 被 park 的任务

普通入站 ──► OpenClaw 身份/意图/能力路由
             ├─ 普通问答/外部操作 ──► OpenClaw 能力（不进入 Tower）
             └─ Tower 消息 ──► route_gateway_message / route_gateway_query

Tower 消息回复 ──► resolve_gateway_task_context（只读）
                  ├─ 查询：只读工具，不恢复终端
                  ├─ OPEN ask：reply_to_ask
                  ├─ 外部操作：携带 towerContext 委派，Tower 状态不变
                  └─ 明确继续开发：continue_bound_task（OWNER + 幂等）
```

图见 `docs/diagrams/tower-harness-flow.html`（中）/ `tower-harness-flow-en.html`（英）。

- Tower 不感知具体 IM 平台，飞书等被隔离在系统之外。
- 出站消息体**必须**包含 `[[tower:task=<id>]]` token，否则人的回复无法归属到任务，任务会永远卡住。
- 发送目标（群 / 人）在「工作」场景由调用方通过 `to` 指定；「无人值守」场景走配置好的 owner/home 目标。

### 消息工具及关系

这些消息工具最容易混淆，务必分清「**发没发**」和「**park 不 park**」两个维度：

| 工具 | 是否真的发出去 | 是否 park 任务 | 用途 |
|------|:---:|:---:|------|
| `ask_human` | ❌ 只登记 | ✅ park | 底层状态原语：登记一个 OPEN 问题 + 挂起任务等回复 |
| `notify_human` | ❌ 只登记 | ❌ 不 park | 底层状态原语：登记一条进展日志，继续干活 |
| `push_to_human` | ✅ 持久化 + 真发 | 按 `expectReply` | 先写 Outbox 与 ask intent，再由 worker 发送并原子登记结果 |
| `reply_to_ask` | —（回灌方向） | resume | 仅回答当前 OPEN ask，并唤醒被 park 的任务 |
| `resolve_gateway_task_context` | —（只读方向） | ❌ | 解析回复关联的项目/任务、状态和最新结果，不落 inbound、不碰终端 |
| `continue_bound_task` | —（显式动作） | ✅ | OWNER 明确要求继续开发时，按平台消息 ID 幂等恢复并注入 |
| `relay_channel_reply` | —（兼容入口） | 仅 OPEN ask | 普通任务回复只返回上下文，不再隐式恢复终端 |

**`ask_human`** —— 只**登记 OPEN 问题 + PARK 任务**（结束当前回合、PTY 保活等回复），**它自己不发消息**。是底层状态原语，和 `reply_to_ask` 配对（park ↔ resume）。调用后必须立即停手等回复。

**`notify_human`** —— 只登记一条日志、**不 park**、继续往下干；同样**不发**。用于里程碑 / 进展播报 / 无需回复的 FYI。

**`push_to_human`** —— **持久化 + 发送 + 登记，一站式**。Tower 先在同一事务内创建
`HarnessMessage(PENDING_DELIVERY)` 与 `HarnessOutbound`，随后 worker 经 Hermes / OpenClaw
发送。收到可验证的平台 message id 后，delivery 映射、OPEN ask 和任务 park 在同一事务完成。
明确失败保持可重试；已有发送证据但回执不完整时进入 `SENT_UNVERIFIED`，不盲目重发。

**`reply_to_ask`** —— OPEN ask 的唯一正常回答动作：原子标记已答、resume 被 park 的任务，并把答案注入终端。`relay_channel_reply` 只保留旧客户端兼容：匹配 OPEN ask 时仍可回答；普通任务回复仅返回上下文，不再注入或恢复。

**`resolve_gateway_task_context` / `continue_bound_task`** —— 前者只读解析 `subjectTaskId`、`producerTaskId`、Workbench、任务状态、OPEN ask 和最近执行摘要；后者才是 OWNER 对“继续改、按失败结果修复、重跑”这类明确开发意图的显式副作用。同一平台消息若已落为只读 `task_context`，续跑会原子升级该 `GatewayInbound`；失败或租约过期仍在同一行重试。终端注入用 inbound ID 做会话内幂等，避免响应不确定时重复提交。

**两组别混：**

- **「停下等回复 ↔ 回复时 resume」= `ask_human` ↔ `reply_to_ask`**：同一个流程的两头（一个 park、一个唤醒）。
- **「只登记不发 ↔ 持久化后真发」= `ask_human` vs `push_to_human`**：前者是纯状态原语，后者是 durable outbox 封装。

`list_notify_targets` 是发送前的入口：读取当前 scope 的活跃通道，返回**照做即可的发送指令**，告诉 Agent 走哪个网关、要不要 park。`tower-ask` / `tower-goal` 技能内部就是先调它、再照指令发。

`route_gateway_message` 是 OWNER 的 Tower 相关渠道入站入口；普通问答和外部能力请求在 OpenClaw 内处理，不调用 Tower。旧客户端传入 `DIRECT` 时返回 `direct_not_supported`，且不创建 `GatewayInbound`。`route_gateway_query` 是
可信群 NON_OWNER 的能力受限入口：它固定为项目讨论，不能转 task reply、创建
任务、启动终端或排入 Workbench；随后只能通过 inbound 绑定读取项目级上下文。
有状态路由先持久化去重，再严格按 reply/task binding → thread/session binding →
显式项目 → 唯一 identify_project → 用户最近项目 → 渠道默认项目解析。项目讨论
必须以 `complete_gateway_discussion` 回原 thread；项目工作只排入 Workbench。
Workbench 读到持久批次后必须先调用 `ack_workbench_batch`，处理或稳定委派后
调用 `resolve_workbench_batch`。只有 `create_task` 真正成功后才能调用
`confirm_gateway_task_created`。审查通过时直接调用 `complete_gateway_work`，
不要先调用 `move_task(DONE)`；该工具会在同一数据库事务内将任务转为 `DONE`
并创建 `FINAL_RESULT` outbox，随后再执行可重试的平台发送。

OWNER 排障优先使用 `diagnose_gateway_request`，它把平台入站、Tower 路由、
Workbench event/batch/runtime、子任务和平台 delivery 关联为一条阶段时间线。
`recover_gateway_request` 只恢复指定 inbound，且不会自动重发
`SENT_UNVERIFIED`。`get_gateway_runtime_health` 补充 OpenClaw/Hermes 的脱敏
健康状态和关联日志。

重复 platform message 不会重放动作：处理中/排队中返回 `in_progress + noOp`，已处理返回 `already_processed + noOp`。无 thread/root 的讨论按 chat + sender 隔离并复用会话，最近项目上下文 7 天过期。失败投递除启动恢复外，还由单例 `unref` 定时器按 `nextAttemptAt` 自动重试。

### 通知中心 `/harness`

`/harness` 路由是这套体系的人机界面——一张表格铺开所有出站消息与回复：

| 列 | 内容 |
|------|------|
| 工作区 / 项目 / 任务 | 消息归属 |
| 发送内容 / 发送时间 | 出站消息与时间戳 |
| 回复内容 / 回复时间 | 人的回复与时间戳 |
| 状态 | OPEN（等回复）/ 已答 / 仅通知 等 |
| 操作 | 查看详情 / 处理 |

- 长内容**三行截断** + hover tooltip 看全文。
- 「查看详情 / 处理」弹窗把**发送 + 回复上下铺开**，人可在此**行内回复**——回复走 `reply_to_ask`，直接 resume 对应任务。
- 没配置任何通道时，`ask_human` 仍会把问题登记进 `/harness` 面板并挂起任务，但无法外发；需到 Settings → Notifications 配置并激活通道。

### ask 等待期 PTY 保活 · 回复注入活终端

`ask_human` 把任务挂起时，走的是「**park 不 kill**」而不是「杀了再 `--resume`」的路子，这样等回复期间上下文不丢：

1. **只置 PAUSED、不杀 PTY**：execution 标记 PAUSED，PTY 会话原样留着。
2. **挂起断连 keepalive 销毁**：parked 期间**暂停 WS 断连的 keepalive 计时**——避免等回复的这段时间里终端因客户端断连（默认运行中 2h keepalive）被回收。
3. **回复直接注入活终端**：人回复时 `reply_to_ask` 把 execution 置回 RUNNING，回复作为下一条消息**注入同一个活 PTY**（`already_running`），接着上一次上下文继续，而**不是**从头 `--resume` 重跑一遍。

这条链路修复见 commit `ecab514`。实现落在 `src/lib/pty/{session-store,ws-server,pty-session}.ts`。

### 父子任务派生

任务可以**被另一个任务派生**：子任务的 `parentTaskId` 指回父任务，子任务描述里带一段 `## 来源` 注明「父任务派生」。父子间不需要新造中途通道，**复用既有的 stop hook fan-out**：

- 子任务**一轮结束**（stop hook）→ `POST /api/internal/hooks/stop` fan-out 到 `notify-parent`（`src/lib/derive/notify-parent.ts`）。
- Codex 同时保留 Stop hook 与 `agent-turn-complete` notifier；两条路径使用同一个 Codex turn id 去重。回合完成即持久化父任务事件，不依赖关闭仍在复用的 PTY。
- `notifyParentOnChildStop` 找到父任务后先按稳定 `dedupKey` 写入 `WorkbenchEvent`；父任务没运行时事件仍保留，不再丢弃。
- 父任务自己的 stop hook 是安全 drain 边界：同一父任务短时间内的普通完成、待决策和失败事件聚合为一个 review batch，并持久化成 `TaskMessage(SYSTEM)` 后才写入 PTY。投递失败会回到 `PENDING`，过期 claim 可在启动时恢复。
- 所有 provider 的 execution completion 都走统一 fallback：FAILED 始终产生高优先级事件；COMPLETED 仅在该 execution 没有 stop-hook review/decision 时补一个普通 review。两类 producer 通过唯一 `executionReviewKey` 原子竞争，避免重复。

于是「子任务中途求助父任务」不需要专门的中途通道——**把 blocker 作为收尾回复结束回合**就够了，stop hook 会 surface 到父任务。父任务在 review 时定夺，用 `send_task_terminal_input` 把决策注入子任务终端回灌。

### 卡住升级阶梯（引导 + 硬禁）

原生阻塞式交互（`AskUserQuestion` / plan 选项菜单）**Tower 无法检测、也无法替人点选**——一旦没人盯着当前终端，它就把任务僵死在那。所以 Harness 给它上了**双层拦截**（**均已落地**）：**引导层**告诉 agent 该走哪条路，**enforcement 层**用 PreToolUse hook 把不该弹的菜单直接 deny 掉。

图见 `docs/diagrams/tower-escalation-ladder.html`（中）/ `tower-escalation-ladder-en.html`（英）。

判定只看两个维度——**有没有父任务** × **有没有人盯着这个终端**——共四种情况。原则：**原生菜单只在「有真人正盯着当前终端」时可用**，其余一律把「问题 + 具体选项」按阶梯**只向上**上报（子 → 父 → 人）：

| 情况 | 原生菜单 | 该怎么做 |
|------|:---:|------|
| **① 无父 + 有人值守** | ✅ 放行（鼓励） | 真人在盯本终端，当场点选。别把选项拍扁成纯文本，直接弹 `AskUserQuestion` 让人选。 |
| **② 无父 + 无人值守** | ✘ 硬禁 | 把问题+选项塞进 `ask_human`（要回复→停下等）或 `push_to_human`，直接发人。 |
| **③ 被父派生 + 有人值守** | ✘ 硬禁 | 人在盯**父任务**、不看你。blocker+选项写成纯文本 final message 正常收尾 → stop hook → `notify-parent` 唤醒父任务定夺。 |
| **④ 被父派生 + 无人值守** | ✘ 硬禁 | 同③收尾上报父任务；父任务定不了，再由**父任务**往上发人。 |

- **父任务自己也定不了**：有人值守就在父任务终端呈现选项让人选（原生 OK），无人值守就 `ask_human` / `push_to_human`。
- **防环**：父任务 review 时**不得把同一问题原样打回子任务**（规则同时写进 `child-review-prompt.ts` 的父任务唤醒引导）。判「定不了」由 agent 自身判断（指令引导），**不做确定性检测**。

**引导层** —— 四情况原则写进内置系统声明 `task.systemDirective` / `task.workbenchDirective`（`src/lib/config-defaults.ts` 的 escalation ladder 段）。

**enforcement 层** —— PreToolUse hook `scripts/tower-pre-tool-hook.js`（Claude + Codex 共用一套脚本）在 `--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` 下**实测 deny 生效**：

- **拦截目标**是各 provider 的交互问答工具名——**Claude=`AskUserQuestion`，Codex=`request_user_input`（两者不同名！）**，均实测确认。一套脚本同时列这两个名字，session 只暴露自己 provider 的那个，列全无害。其余工具一律放行。
- **判定**：`allow ⇔ 无父任务 且 有人值守（情况①）`；`deny ⇔ 有父任务 或 无人值守（②③④）`，deny 时返回 `permissionDecision:"deny"` + 一段引导改走阶梯的说明。
- **状态从 spawn 时注入的 env 读**（因 PTY 剥了 `TOWER_DATA_DIR`，只能注入解析好的路径）：
  - `TOWER_HAS_PARENT` —— 有 `parentTaskId` 时注入（静态）。
  - `TOWER_SIGNAL_DIR` —— 信号目录；`unattended-<taskId>` 文件存在 ⇔ 无人值守。该文件由 `set_goal_mode` / 状态流转经 `src/lib/harness/unattended-signal.ts` 写删，镜像 DB 的 `task.unattended` 列（standalone hook 无 DB 访问，只能读文件）。fail-open：读不到信号文件按「有人值守」处理。
- **Codex 侧**：spawn 补 `--dangerously-bypass-hook-trust`，`[features]` 特性名从 `codex_hooks` 迁到 `hooks`；Hermes 是网关适配器无 PTY，不涉及。

## 已知限制 / 后续

- **worktree 里 SessionStart hook 加载失败**：`node:internal/modules/cjs/loader:1424` 报错会导致 `execution.sessionId` 存不上，`--resume` 兜底不可靠。保活修复后此路径极少触发，但仍是独立待修问题。

## 文件清单

### MCP Tools (`src/mcp/tools/harness-tools.ts`)

- `list_notify_targets` / `push_to_human` / `ask_human` / `notify_human` / `reply_to_ask` / `relay_channel_reply`
- `resolve_gateway_task_context` / `continue_bound_task`
- `route_gateway_message` / `route_gateway_query` / `read_gateway_project_context`
- `complete_gateway_discussion` / `confirm_gateway_task_created` / `complete_gateway_work`
- `diagnose_gateway_request` / `recover_gateway_request` / `get_gateway_runtime_health`
- `provision_remote_project`

### 核心库 (`src/lib/harness/`)

| 文件 | 说明 |
|------|------|
| `gateway-send.ts` | 经 Hermes / OpenClaw 网关 CLI 出站发送 |
| `gateway-config.ts` | 网关运行时配置（显示名等） |
| `delivery-map.ts` | 平台消息 ID ↔ 任务的投递映射，`[[tower:task=...]]` token 提取 |
| `gateway-router.ts` | 入站去重、会话绑定、项目解析、Workbench 排队、可靠完成回传 |
| `gateway-diagnostics.ts` | 单条外部请求的跨层 trace 与受控恢复 |
| `gateway-runtime-health.ts` | OpenClaw/Hermes 健康状态、关联日志和脱敏 |
| `gateway-maintenance.ts` | Gateway 状态/文本字节只读观测；编码七天终态关系谓词，不执行压缩 |
| `remote-project-provisioner.ts` | OWNER 远程 Git 接入、幂等登记与 REVIEW_ONLY/FULL_WORK |
| `gateway-output.ts` | Hermes/OpenClaw 发送结果的结构化 message id 提取 |
| `unattended-signal.ts` | 无人值守信号文件 `unattended-<taskId>` 写删，供 PreToolUse hook 读 |

### 父子派生 (`src/lib/derive/`)

| 文件 | 说明 |
|------|------|
| `notify-parent.ts` | 子任务 stop → 去重写入 Workbench 持久化事件 inbox |
| `child-review-prompt.ts` | 父任务唤醒引导 prompt（含「别原样打回」防环规则） |

### Workbench 协调器 (`src/lib/workbench/`)

| 文件 | 说明 |
|------|------|
| `coordinator.ts` | 事件入库、claim lease、批量聚合、失败释放与边界 drain |
| `boundary.ts` | 父任务已结束当前回合的进程内门闩；任何新 PTY 输入都会关闭 |
| `maintenance.ts` | Workbench batch 状态/文本字节只读观测；`WorkbenchEvent.payload` 永不修改 |

### Hook 脚本 (`scripts/`)

- `tower-pre-tool-hook.js` —— PreToolUse 硬禁原生问答工具（enforcement 层）；注册/卸载在 `packages/ai-provider-claude/src/adapter.ts`

### 系统声明 (`src/lib/config-defaults.ts`)

- `task.systemDirective` / `task.workbenchDirective` —— 升级阶梯四情况引导（引导层）

### API Routes（内部桥接 `src/app/api/internal/harness/`）

| 路由 | 说明 |
|------|------|
| `POST /ask` | 登记 OPEN 问题 + 挂起 execution（PAUSED） |
| `POST /reply` | 回灌回复、resume 任务；无 OPEN 问题返回 409 `no_pending` |
| `POST /notify` | 登记一条进展日志 |
| `POST/PATCH/PUT /gateway` | 入站路由、完成登记、讨论/任务结果可靠回传与重试 |
| `POST/PUT /gateway-task` | 无副作用任务绑定解析 / OWNER 显式幂等续跑 |

### 通知中心

- `src/app/harness/harness-client.tsx` — `/harness` 表格 UI、详情/处理弹窗、行内回复

### PTY 保活 (`src/lib/pty/`)

- `session-store.ts` / `ws-server.ts` / `pty-session.ts` — parked 期间挂起断连 keepalive，回复注入活终端

## 相关

- MCP 工具全景见 [MCP 模块](./mcp)
- 终端与断连保活见 [Terminal 模块](./terminal)
- 进程生命周期与 hook fan-out 约定见 `.claude/rules/process-lifecycle.md`
