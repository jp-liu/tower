# Task Source (`## 来源`)

**Tower renders `## 来源` server-side** — you usually don't hand-format it. The
`create_task` handler guarantees the section regardless of what you send:

- **No source** → it appends `## 来源\n无`. You can omit the section entirely.
- **Parent-derived** (`TOWER_TASK_ID` set) → it appends the parent-derivation
  source AND records `parentTaskId` structurally. Just create the task.
- **Bridge block** (`<task-source>…</task-source>`) → **pass the block through
  verbatim inside `description`**. The handler strips the raw block and renders a
  channel-generic `## 来源`. Do NOT hand-strip or reformat it — passing it
  through is enough and more reliable.

This file documents the block format and the rendering the server produces, so
you understand what lands in the task. Read it only when a prompt carries a
`<task-source>` block or you want to hand-render the parent case.

## Parent task derivation (派生子任务)

If `TOWER_TASK_ID` is set (run `echo $TOWER_TASK_ID`), you are inside a Tower task
terminal, so any task you create is a child of the current task. The server
renders:

```
## 来源

- 渠道：父任务派生
- 父任务：{父任务标题}（id: $TOWER_TASK_ID）
```

`parentTaskId` is also recorded structurally (used for parent→child completion
notifications). The id alone is enough if the title is unknown.

## Bridge metadata contract (`<task-source>` block)

External bridges (Feishu/WeChat/OpenClaw…) inject a machine-readable block into
the message. **Pass it through verbatim in `description`** — the server parses it
and renders the standardized `## 来源`, dropping the raw block:

```
<task-source>
channel: feishu                      # platform enum — see the channel map below
chat_name: 南京招生报名讨论群          # group display name
chat_id: oc_xxxxxxxx                 # group ID (hard anchor, keep)
occurred_at: 2026-06-16 17:49 +08:00 # trigger time with timezone
chat_link: https://applink.feishu.cn/client/chat/open?openChatId=oc_xxxxxxxx
trigger_message_id: om_xxxxxxxx      # the triggering message ID (hard anchor, keep)
thread_root_id: om_yyyyyyyy          # (optional) thread root message ID
bridge: hermes                       # (optional) transport bot — see "记平台不记搬运工"
participants:                        # display name + open_id + role
  - name: 张斯佳, open_id: ou_aaa, role: 讨论
  - name: 刘俊平, open_id: ou_ccc, role: 确认
transcript: |                        # the actual message text people read (keep)
  17:49 张斯佳：有线下核验点，无可预约时间，需要加提示么？
  17:5x 刘俊平：可以处理
summary: 线下核验点无可预约时间，确认合并提示语后处理   # (optional) one-line conclusion
</task-source>
```

### Channel map (渠道 → 渲染前缀)

`channel` is a platform **enum**; the server maps it to a localized prefix.
Unknown channels fall back to the raw value.

| `channel` | Rendered prefix |
|-----------|-----------------|
| `feishu`  | 飞书群          |
| `lark`    | Lark 群         |
| `wechat`  | 微信群          |
| `wecom`   | 企业微信群      |
| `openclaw`| OpenClaw        |
| `manual`  | 手动创建        |

### 记平台不记搬运工 (channel vs bridge)

`channel` is the **real platform where the discussion happened** (WeChat/Feishu).
The **transport bot** that carried the message into Tower (hermes / openclaw) is a
separate, optional `bridge` field — it renders as a secondary `传输` line, never
as the main channel. Swapping the bot doesn't change the source meaning.

> **Scope note:** injecting the correct `channel`/`bridge` is each bridge bot's job
> (in its own repo). Tower only guarantees parse/render for **any** channel.

## Rendered `## 来源` (what the server produces)

```
## 来源

- 渠道：飞书群「{chat_name}」
- 传输：{bridge}                     # only when bridge is present
- 时间：{occurred_at}
- 参与者：{name1、name2、…}
- 讨论要点：{summary}
- 打开群：{chat_link}
- 溯源 ID：chat={chat_id} · msg={trigger_message_id}{ · thread={thread_root_id}}

讨论摘录（按时间）：
{transcript}
```

Only lines whose data is present are emitted. `chat_id` + `trigger_message_id`
(hard anchors) and the `transcript` (what humans read) are the fields that matter.

**Feishu reality** — `chat_link` opens the **group**, not a single message. The
practical "go back and find it" combo is 群链接 + occurred_at + transcript. The
line is labelled **打开群** (never "原始消息"). `trigger_message_id` is the only
hard anchor to the exact message (not clickable — for programmatic re-read/dedup).

Role inference (谁提出/讨论/拍板) and summary derivation from the transcript are
**soft** — the server does not compute them. If you want a richer `参与者`/`讨论要点`
than the raw fields, render `## 来源` yourself and drop the block; the server keeps
your section and only strips the raw block.
