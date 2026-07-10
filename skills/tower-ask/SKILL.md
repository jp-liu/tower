---
name: tower-ask
description: 把消息真正发给人（无人值守外推的「发送」动作）。当你在任务终端里要「发给 xxx / 发送到 xxx / 通知 xxx / 告诉 xxx / 告知 / 汇报给 / 让 xxx 知道」某群/某人某条消息时使用；tower-goal 内部也调用它。Use whenever you need to actually deliver a message to a human/group from a task terminal (send to X, notify X, tell X, report to X).
---

# tower-ask — 把消息发给人

Tower 的 `ask_human` / `notify_human` 工具**只在 Tower 内记录 + park，绝不替你外发**。要让人真正收到，必须你自己用**挂载的平台 MCP**（飞书 / openclaw / hermes…）把消息发出去。这个 skill 就是那套「怎么发」的规则。

## 何时用

任务终端里出现「把 X 发给某群/某人」「通知后端值班群…」「告诉老板…」「汇报进度给…」这类**要把内容送到某个真人/群**的意图时。tower-goal 长跑中要外推，也走这里。

**边界**：往代码/文件里写东西、给 PR 留评论、终端内部操作——**不是** tower-ask，别触发。

## 拿 taskId

关联口令要用当前任务 id：读环境变量 `TOWER_TASK_ID`（等价 `AI_MANAGER_TASK_ID`）。拿不到就停下问用户，别瞎编——口令错了对方回复无法归属。

## 三步发送

### 1. 确定走哪条渠道

- 若系统提示里已注入「生效渠道」（无人值守启动的任务会有），直接用。
- 否则调 `list_notify_targets`：
  - 返回 `{ active: { gateway, downstream? } }` → 用它。
  - 返回 `{ noChannelConfigured: true }` → **不要臆造已发**。告诉用户「请到 设置 → 通知 → 无人值守发送渠道 配一条并设为生效，否则无法外发」，然后停。

### 2. 确定发给谁

目的地（群名/人名）由**触发语境**给出（"发给后端值班群"）。只知道名称、没有平台 id → 先用平台 MCP 按名称查出 id 再发（同设置里「测试」按钮的逻辑）。

### 3. 发送（正文必带口令）

正文**必须逐字**包含关联口令，漏了 = 对方回复无法归属 = 任务永久卡死：

```
[[tower:task=<taskId>]]
```

按生效渠道的 `gateway` 用对应平台 MCP：

- `gateway=feishu` → 用飞书 MCP 直发，如 `mcp__feishu__im_v1_message_create` 到 `<目的地>`，正文带口令。
- `gateway=openclaw` / `hermes`（网关转下游）→ 用对应 MCP，正文里写明「通过 `<downstream>`（如微信）发给 `<目的地>`」，例如：
  > 用 openclaw 通过微信发给「后端值班群」：登录页改造需要你拍板…… `[[tower:task=cxxx]]`

## 发送成功后再留档

**发送成功**（第 3 步平台 MCP 返回 ok）之后，才调 Tower 工具记录：

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
