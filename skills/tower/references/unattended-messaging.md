# Tower 无人值守 · 收发消息规则

Tower **不发送、不接收平台消息**，也不维护「任务 ↔ 会话/群」的绑定。Tower 只做三件事：

1. **记录** 每一条 ask/notify/done/failed（`/harness` 面板即操作日志）。
2. **park / resume** 任务执行的生命周期（外部工具碰不到）。
3. 定义**这份规则**，供任意 agent/bridge（bot、OpenClaw、Hermes…）遵循。

真正把消息发到飞书/微信/…、以及把人的回复送回来，由 **agent 用它自己挂载的平台 MCP** 完成。飞书等平台协议、凭据、连接**全部隔离在 Tower 之外**。

---

## 角色

| 角色 | 是谁 | 干什么 |
|------|------|--------|
| **tower-loop（无人值守）** | 带 goal 启动的任务执行 | 设一个目标像普通 goal 一样跑；遇到阻塞用 `ask_human` 发问、用 `notify_human` 汇报。`unattended=1` 时终端注入 `TOWER_UNATTENDED=1`。 |
| **tower-ask（出站）** | 任务 agent | 按下面的格式把问题/进度**用平台 MCP 发出去**，再调 `ask_human`/`notify_human` 让 Tower 记录 + park。 |
| **bridge（入站）** | 常驻的 MCP agent（bot / OpenClaw / …） | 收平台上人的回复 → 认出 taskId → 用 `reply_to_ask(taskId, text)` 送回任务。非任务类（创建/查询）用普通 MCP 工具处理。 |

---

## 出站：怎么把消息发给人

任务 agent 在无人值守下需要发问或汇报时：

1. **决定用哪个工具**
   - `ask_human`：被卡住、需要决策、或做危险/不可逆操作前要签字。**阻塞 + 结束本回合**，任务被 park。
   - `notify_human`：里程碑 / 进度 / FYI，**不阻塞**，继续干。

2. **组织消息，必须带关联口令**（硬规则）
   消息正文**必须逐字**包含关联口令，bridge 靠它把「平台上的这条线程」对回 taskId：

   ```
   [[tower:task=<taskId>]]
   ```

   漏了口令 = 人的回复无法归属 = 任务永久卡死。

3. **用一条「网关 → 下游」渠道把它发出去**
   渠道来自设置里的注册表（`harness.targets`），每条含 `gateway`（feishu/openclaw/hermes）+
   `downstream`（wechat/feishu/qq/… 或自定义）。**发到哪个群/人在消息里说清楚**（注册表不预设目的地）。
   按网关措辞：

   **统一消息模板（填空）**：

   ```
   【发送目标】<群组 或 人员>｜【消息】<正文>｜[[tower:task=<taskId>]]
   ```

   - `gateway=feishu` → 用飞书 MCP 直发：`mcp__feishu__im_v1_message_create` 到 `<发送目标>`，正文带口令。
   - `gateway=openclaw` / `hermes`（网关转下游）：
     > 用 **openclaw** 通过 **微信** 发给「后端值班群」：登录页改造需要你拍板…… `[[tower:task=cxxx]]`

   —— `downstream` 决定"通过什么"，目的地（群/人）由消息正文给出。

4. **调 Tower 记录 + park**：`ask_human(taskId, question)` 或 `notify_human(taskId, message)`。
   Tower 只记一条日志行并 park —— **不会再重复发送**。

> 记录的 `content` 应与你发出去的正文一致（口令可省略在记录里），这样 `/harness` 日志里「问了什么」才准确。

> **没有配置任何渠道时**（`harness.targets` 为空，`ask_human` 会返回 `noChannelConfigured: true`）：
> **不要臆造发送**。直接告诉用户「请到 **设置 → 通知 → 无人值守发送渠道** 配置一个渠道，否则无法外发对应消息」。
> 问题仍已记录、在 `/harness` 面板可见可回复，只是不会推到外部渠道。

---

## 入站：怎么把回复送回任务

人在平台上回复后：

1. 回复先到 **bridge**（它连着平台，这是它的事）。
2. bridge 从线程/上下文里的 `[[tower:task=<taskId>]]` 口令**取出 taskId**（这张「线程↔taskId」映射由 bridge 自己维护，Tower 不管）。
3. bridge 调 **`reply_to_ask(taskId, text)`** —— **不要**用裸的 `send_task_terminal_input`。
   `reply_to_ask` 会：标记该 ask 为已回复 + **记录回复内容**（`/harness` 日志可见）+ resume 会话 + 把回复注入为任务下一条消息。
4. 若返回 `{ no_pending: true }`：该任务没有待回复的问题 → 把这条消息当**普通请求**正常处理（`create_task` / `search` / …）。

## 非任务类消息（创建 / 查询）

发给 bridge 的不一定是对某个 ask 的回答。没有关联口令、或 `reply_to_ask` 回 `no_pending` 的，就用普通 Tower MCP 工具照常处理，**不进 harness 日志**（harness 日志只收 ask 的一问一答闭环）。以后想给普通 MCP 操作也留痕，在 MCP 层加埋点即可，不改这套。

---

## 一句话契约

> Tower 记录 + park/resume；agent 用平台 MCP 收发；口令 `[[tower:task=<id>]]` 是唯一的归属钥匙；回复一律走 `reply_to_ask`。
