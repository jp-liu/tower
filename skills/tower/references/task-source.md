# Task Source (`## 来源`) — detailed rendering

Read this when the incoming prompt carries real source info — a parent-task
derivation (`TOWER_TASK_ID` set) or a `<task-source>` bridge block. For the
common "no source" case you don't need this file: just write `## 来源\n无`.

## Parent task derivation (派生子任务)

If `TOWER_TASK_ID` is set in your environment (run `echo $TOWER_TASK_ID` to check),
you are operating **inside a Tower task terminal** — so any task you create here is
a **child task derived from the current (parent) task**. Render its source as:

```
## 来源

- 渠道：父任务派生
- 父任务：{当前任务标题，知道就填}（id: $TOWER_TASK_ID）
```

Tower also records this link structurally on the new task's `parentTaskId`
automatically (used for parent→child completion notifications) — this `## 来源`
is just the human-readable mirror. The id alone is enough if you don't know the title.

## Bridge metadata contract (`<task-source>` block)

External bridges (Feishu/Lark, etc.) inject a machine-readable block into the
message. When you see it, parse it, render the standardized `## 来源`, and then
DROP the raw block from the description (don't store the tags):

```
<task-source>
channel: feishu                      # 渠道 (feishu | openclaw | manual | ...)
chat_name: 南京招生报名讨论群          # 群显示名
chat_id: oc_xxxxxxxx                 # 群 ID（硬定位符，必带）
occurred_at: 2026-06-16 17:49 +08:00 # 讨论/触发时间，带时区（用于进群后定位到具体那条）
chat_link: https://applink.feishu.cn/client/chat/open?openChatId=oc_xxxxxxxx  # 打开「群」的链接（群级，飞书无法精确到单条消息）
trigger_message_id: om_xxxxxxxx      # 触发那条消息的 ID（不可点，但唯一绑定该消息，必带；用于程序回读/去重/兜底）
thread_root_id: om_yyyyyyyy          # （可选）话题根消息 ID
participants:                        # 参与者：显示名 + open_id + 角色
  - name: 张斯佳, open_id: ou_aaa, role: 讨论
  - name: 张瑶,   open_id: ou_bbb, role: 讨论
  - name: 刘俊平, open_id: ou_ccc, role: 确认
transcript: |                        # 相关消息原文（按时间）—— 人真正要看的内容，必带
  17:49 张斯佳：有线下核验点，但无可预约时间，这里需要加提示么？
  17:5x 张瑶：建议合并提示语「目前暂无线下审核点或没有可预约的时间…」
  17:5x 刘俊平：可以处理
summary: 线下核验点无可预约时间，确认合并提示语后处理   # （可选）一句话结论；缺省时由模型从 transcript 推
</task-source>
```

Roles are not required to be pre-computed by the bridge — if `role` is missing,
infer it from the `transcript` (谁提出 / 谁讨论 / 谁拍板"可以处理"). If a
`summary` is absent, derive it from the `transcript`.

**Feishu reality** — `chat_link` only opens the **group**, not a single message.
So the practical "go back and find it" combo is **群链接 + occurred_at + transcript**:
open the group, jump to that time, the transcript is the actual content. Label the
link line **打开群** (never "原始消息") so nobody expects a one-click jump to the
exact message. `trigger_message_id` is kept as the only hard anchor to that
message (not clickable — for programmatic re-read / dedup / fallback).

## Rendered `## 来源` format

```
## 来源

- 渠道：飞书群「{chat_name}」
- 时间：{occurred_at}
- 参与者：{讨论者们}（讨论），{确认者}（确认可处理）
- 讨论要点：{summary}
- 打开群：{chat_link}
- 溯源 ID：chat={chat_id} · msg={trigger_message_id}{ thread_root_id 时追加 · thread={thread_root_id}}

讨论摘录（按时间）：
{transcript}
```

Only render lines whose data is present (e.g. omit `打开群` if there is no
`chat_link`). Always keep `chat_id` + `trigger_message_id` (hard anchors) and the
`讨论摘录`/`transcript` (the content humans actually read).
