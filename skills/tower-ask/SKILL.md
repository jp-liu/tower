---
name: tower-ask
description: 把消息真正发给人（无人值守外推的「发送」动作）。当你在任务终端里要「发给 xxx / 发送到 xxx / 通知 xxx / 告诉 xxx / 告知 / 汇报给 / 让 xxx 知道」某群/某人某条消息时使用；tower-goal 内部也调用它。Use whenever you need to actually deliver a message to a human/group from a task terminal (send to X, notify X, tell X, report to X).
---

# tower-ask — 把消息发给人

Tower 的 `ask_human` / `notify_human` 工具**只在 Tower 内记录 + park，绝不替你外发**。要让人真正收到，必须你自己用**挂载的平台 MCP**（飞书 / openclaw / hermes…）把消息发出去。这个 skill 就是那套「怎么发」的规则。

## 何时用

任务终端里出现「把 X 发给某群/某人」「通知后端值班群…」「告诉老板…」「汇报进度给…」这类**要把内容送到某个真人/群**的意图时。tower-goal 长跑中要外推，也走这里。

**边界**：往代码/文件里写东西、给 PR 留评论、终端内部操作——**不是** tower-ask，别触发。

## 三步发送

### 1. 先判断类别（scope），再拿「填好真实渠道的发送指令」

渠道分两类，先判断这次属于哪类：

| scope | 什么时候 | 特点 |
|-------|---------|------|
| **`work`** | 你在场（日常上班），用户显式让你**发某群/某人讨论方案**（"发飞书 a 群…确认结果告诉我"） | 目的地由指令给出；发完**不 park、不关终端**，等用户回终端说结论 |
| **`unattended`** | 你不在（`tower-goal` 下班长跑），要**找用户本人拍板** | 目的地=本人；需回复才能继续则 `ask_human` **park** 等 bridge 注入 |

判据：**用户显式点名了发给哪个群/人 → `work`；没指定、要找本人拍板 → `unattended`。**

调 **`list_notify_targets`**（传 `scope` + 当前 `taskId` = 环境变量 `TOWER_TASK_ID`）。它**读 Tower 数据库里该类别的生效渠道**，返回组装好的 `instructions`——已填好真实网关（飞书 / openclaw…）、下游、带你 taskId 的口令 `[[tower:task=<id>]]`，还写明了这类要不要 park。**照着 `instructions` 做即可**。

- 返回 `{ noChannelConfigured: true }` → **不要臆造已发**。work 类没配可直接用你挂载的平台 MCP 发到用户指定的群；unattended 类没配则按 `instructions` 让用户去「设置 → 通知」配一条并设为生效，然后停。

### 2. 确定发给谁

目的地（群名/人名）由**触发语境**给出（"发给后端值班群"）。只知道名称、没有平台 id → 先用平台 MCP 按名称查出 id 再发（同设置里「测试」按钮的逻辑）。

### 3. 按 instructions 发送 + 留档

用 `instructions` 指定的平台 MCP 把消息发出去，正文**必须逐字**含其中的口令。**发送成功后**才调 Tower 工具记录：

- 需要对方**回复**才能继续（决策 / 缺信息 / 危险操作签字）→ `ask_human(taskId, question)`：记录 + **park**，你的回合到此结束，停下等回复。
- 只是**告知 / 进度 / FYI**，无需回复 → `notify_human(taskId, message)`：只记录，不 park，继续干。

记录的 `content` 与你发出去的正文一致（口令可省），这样 `/harness` 面板里「问了什么」才准。

## 硬规则

- **一律直接发，不二次确认**。识别到「发给 X」意图就发，别先问「要发吗」。
- **平台发送失败**时**绝不**调 `ask_human`（否则任务被 park 却没人收到，永久卡死）——重试，或把消息留在 `/harness` 面板后停下等人。
- 顺序**不可颠倒**：先经平台 MCP 发出去 + 确认成功 → 再调 `ask_human`/`notify_human`。这两个工具本身不外发。
- 同一任务同一时刻只有一条待回复 ask（`ask_human` 会自动取消旧的 OPEN ask）；`[[tower:task=<id>]]` 即幂等键。

## 一句话契约

> 平台 MCP 发（带口令）→ 确认成功 → 再 `ask_human`/`notify_human` 留档。口令 `[[tower:task=<id>]]` 是唯一的归属钥匙。
