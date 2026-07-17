---
title: Harness 模块
description: 无人值守消息体系 —— Tower 作为「登记 + 挂起 + 回灌」的胶水，收发外包给外部网关
---

**Slug:** `harness`

## 功能介绍

Harness 是 Tower 的**无人值守消息体系**。当任务在长时间自主运行（L2 无人值守）时，Agent 需要在被卡住、需要决策或要报告进展时联系人；人回复后任务要能被唤醒继续。这一套「联系人 → 挂起 → 回灌唤醒」的能力就由 Harness 提供。

核心设计是**中继模型**：

- **Tower 自己不接飞书/微信，也不直接发消息**（旧的内置 SDK 发送栈已删除）。
- 真正的收发外包给**外部网关 Hermes / OpenClaw**（独立仓库 / 外部服务）。
- Tower 只做三件胶水事：**登记问题、挂起任务（park）、回复回灌唤醒（resume）**。
- 平台线程 ↔ 任务的映射维护在网关侧，靠出站消息里携带的口令 `[[tower:task=<id>]]` 关联——人的回复带回这个 token，网关就知道该回灌给哪个任务。

## 详细说明

### 中继架构

```
Task Agent (MCP 工具)
   │  push_to_human / ask_human / notify_human
   ▼
Tower（登记 + park/resume，只记录不直连平台）
   │  push_to_human 经网关 CLI 出站
   ▼
外部网关 Hermes / OpenClaw ──► 飞书 / 微信 / … （线程↔任务映射在网关侧）
   ▲
   │  人的回复（携带 [[tower:task=<id>]] token）
   ▼
relay_channel_reply / reply_to_ask ──► resume 被 park 的任务，注入活终端
```

- Tower 不感知具体 IM 平台，飞书等被隔离在系统之外。
- 出站消息体**必须**包含 `[[tower:task=<id>]]` token，否则人的回复无法归属到任务，任务会永远卡住。
- 发送目标（群 / 人）在「工作」场景由调用方通过 `to` 指定；「无人值守」场景走配置好的 owner/home 目标。

### 四个消息工具及关系

这四个工具最容易混淆，务必分清「**发没发**」和「**park 不 park**」两个维度：

| 工具 | 是否真的发出去 | 是否 park 任务 | 用途 |
|------|:---:|:---:|------|
| `ask_human` | ❌ 只登记 | ✅ park | 底层状态原语：登记一个 OPEN 问题 + 挂起任务等回复 |
| `notify_human` | ❌ 只登记 | ❌ 不 park | 底层状态原语：登记一条进展日志，继续干活 |
| `push_to_human` | ✅ 真发 + 登记 | 按 `expectReply` | 上层一站式封装：先经网关发出，成功后再自动转调 ask/notify |
| `reply_to_ask` / `relay_channel_reply` | —（回灌方向） | resume | 把人的回复注入被 park 的任务并唤醒 |

**`ask_human`** —— 只**登记 OPEN 问题 + PARK 任务**（结束当前回合、PTY 保活等回复），**它自己不发消息**。是底层状态原语，和 `reply_to_ask` 配对（park ↔ resume）。调用后必须立即停手等回复。

**`notify_human`** —— 只登记一条日志、**不 park**、继续往下干；同样**不发**。用于里程碑 / 进展播报 / 无需回复的 FYI。

**`push_to_human`** —— **发送 + 登记，一站式**。先经网关 CLI 把消息真的发出去，**成功后**再按 `expectReply` 自动转调 `ask_human`（`true` → park）或 `notify_human`（`false`）。是上层封装，**仅支持 Hermes / OpenClaw** 网关。这是有网关场景下的首选：省去「手动发 + 手动 ask」两步。

**`reply_to_ask` / `relay_channel_reply`** —— 回灌方向。把人在平台上的回复带回 Tower：标记 OPEN 问题为已答、resume 被 park 的任务、把回复作为任务的下一条消息注入活终端。`relay_channel_reply` 额外负责从入站平台消息里解析 `[[tower:task=...]]` token 并按投递映射决定「答 ask」还是「注入工作群讨论」。

**两组别混：**

- **「停下等回复 ↔ 回复时 resume」= `ask_human` ↔ `reply_to_ask`**：同一个流程的两头（一个 park、一个唤醒）。
- **「只登记不发 ↔ 真发 + 顺带登记」= `ask_human` vs `push_to_human`**：前者是纯状态原语，后者是先发再登记的上层封装。

`list_notify_targets` 是发送前的入口：读取当前 scope 的活跃通道，返回**照做即可的发送指令**，告诉 Agent 走哪个网关、要不要 park。`tower-ask` / `tower-goal` 技能内部就是先调它、再照指令发。

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

### ask 等待期 PTY 保活

`ask_human` 把任务挂起时，**只把 execution 置为 PAUSED、不杀 PTY**：

- parked 期间**挂起 WS 断连的 keepalive 销毁**——避免等回复的这段时间里终端因断连（默认运行中 2h keepalive）被销毁。
- 人的回复**直接注入活终端**（`already_running`），接着上一次上下文继续，而**不是**从头 `--resume` 重跑一遍。
- 这条链路修复见 commit `ecab514`。

## 已知限制 / 后续

- **Claude CLI 原生选项菜单无检测**：子任务若卡在 Claude CLI 的原生阻塞交互（`AskUserQuestion` / plan 选项菜单）上，Tower **无法检测**，无人值守下会僵死。拟定方向：引导子任务凡需人拍板时统一用 `ask_human`、禁用原生阻塞交互（方向 A，**待定未实现**）。
- **worktree 里 SessionStart hook 加载失败**：`node:internal/modules/cjs/loader:1424` 报错会导致 `execution.sessionId` 存不上，`--resume` 兜底不可靠。保活修复后此路径极少触发，但仍是独立待修问题。

## 文件清单

### MCP Tools (`src/mcp/tools/harness-tools.ts`)

- `list_notify_targets` / `push_to_human` / `ask_human` / `notify_human` / `reply_to_ask` / `relay_channel_reply`

### 核心库 (`src/lib/harness/`)

| 文件 | 说明 |
|------|------|
| `gateway-send.ts` | 经 Hermes / OpenClaw 网关 CLI 出站发送 |
| `gateway-config.ts` | 网关运行时配置（显示名等） |
| `delivery-map.ts` | 平台消息 ID ↔ 任务的投递映射，`[[tower:task=...]]` token 提取 |

### API Routes（内部桥接 `src/app/api/internal/harness/`）

| 路由 | 说明 |
|------|------|
| `POST /ask` | 登记 OPEN 问题 + 挂起 execution（PAUSED） |
| `POST /reply` | 回灌回复、resume 任务；无 OPEN 问题返回 409 `no_pending` |
| `POST /notify` | 登记一条进展日志 |

### 通知中心

- `src/app/harness/harness-client.tsx` — `/harness` 表格 UI、详情/处理弹窗、行内回复

### PTY 保活 (`src/lib/pty/`)

- `session-store.ts` / `ws-server.ts` / `pty-session.ts` — parked 期间挂起断连 keepalive，回复注入活终端

## 相关

- MCP 工具全景见 [MCP 模块](./mcp)
- 终端与断连保活见 [Terminal 模块](./terminal)
