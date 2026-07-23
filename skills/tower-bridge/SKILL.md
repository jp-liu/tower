---
name: tower-bridge
description: Route content from a Tower task to the right gateway, human channel, sibling task, or operator agent. Use when the user asks to hand off results, notify o-tower, ask xiao-fei/another operator to act, send content through the Tower gateway, or route work that is not just a human/group message. For plain human messaging, tower-ask remains the lower-level send primitive.
---

# tower-bridge — route content through Tower gateways

Use this skill when a task needs to hand content to another execution owner:

- `o-tower` should receive a summary and route it through its local extensions.
- A specialist operator such as `xiao-fei` should perform Feishu document, wiki, Sheet, Bitable, Drive, or permission work.
- A human/group/channel should receive a message, possibly after an operator result is ready.
- A running sibling Tower task should continue with new input.

`tower-bridge` is a router. It does not grant new third-party permissions. External capability still belongs to the configured gateway/operator.

## Relationship To tower-ask

- `tower-ask`: send or ask a real human/group/channel.
- `tower-bridge`: decide where content should go, then use the right primitive:
  - human/group/channel -> follow `tower-ask`
  - Tower task/agent terminal -> `resume_task_execution` then `send_task_terminal_input`
  - OpenClaw operator -> gateway/native command such as `openclaw agent --agent xiao-fei --json --message-file <task-file>`
  - unknown/ambiguous route -> ask the current task owner for a precise target

Do not use `tower-ask` to send work to `o-tower` or an operator agent. `tower-ask` is outbound human messaging, not agent delegation.

## Route Selection

Pick one route:

| intent | route |
|---|---|
| "send/tell/notify/ask the group/person" | use `tower-ask` |
| "tell o-tower / send to 小塔 / let 小塔 route it" | send to the `o-tower` Tower task/agent terminal |
| "let 小飞 handle Feishu" | call `xiao-fei` directly if available, otherwise send to `o-tower` with a delegation request |
| "write/create/read Feishu docs/sheets/wiki/base" | prefer `xiao-fei`; `o-tower` owns the user-facing reply |
| "continue/check a sibling task" | `resume_task_execution` and `send_task_terminal_input` |

For Feishu:

- 普通表格 / Sheet / 工作簿 / 多 sheet -> ordinary Sheets via `xiao-fei`.
- 多维表格 / Base / 数据表 / 字段 / 记录 -> Bitable/Base via `xiao-fei`.
- 文档页面 / 知识库页面 / 云盘 / 文件夹 / 附件 / 权限 -> `xiao-fei`.

## Sending To A Tower Task

When the target is another Tower task or `o-tower`:

1. Identify or search the task.
2. If needed, call `resume_task_execution` by exact task id or unambiguous task name.
3. Call `send_task_terminal_input` with a concise structured handoff.
4. Read recent terminal output if the user expects immediate confirmation.

Do not park the current task just because you sent a bridge message. Park only if the user explicitly needs a reply before continuing.

## Sending To An OpenClaw Operator

When local OpenClaw is available and the route clearly names an operator:

1. Create a temporary Markdown task file.
2. Run the operator command configured for that agent, for example:

```bash
openclaw agent --agent xiao-fei --json --message-file "$task_file"
```

3. Parse the result enough to return:
   - whether it succeeded
   - created/updated links
   - actions taken
   - blockers such as auth/login/scope problems

If the operator reports login/token failure and exposes a login helper, trigger it or report the exact next action.

## Handoff Format

Use this shape when sending to `o-tower` or an operator:

```yaml
bridgeRequest:
  sourceTaskId: "<current Tower task id if available>"
  sourceTitle: "<current task title if available>"
  target: "o-tower | xiao-fei | <operator>"
  capability: "feishu.sheets | feishu.docs | tower.task | human.message | ..."
  goal: "<one sentence>"
  mode: "read-only | write-after-confirmation | write-confirmed"
  inputs:
    links: []
    files: []
    summary: ""
    data: {}
  expectedOutput:
    - "business summary"
    - "links created or changed"
    - "actions taken"
    - "risks/blockers"
  constraints:
    - "Never expose secrets, tokens, raw config, temp file paths, or MCP namespaces to users."
    - "For write/delete/bulk/permission/outbound-send, confirm unless already explicitly authorized."
```

## Result Handling

After the route completes:

- If the result came from an operator, summarize it for the current user/task.
- If it created or updated documents, include business links and a short content summary.
- If it needs confirmation, present the plan and wait.
- If it failed because no route/operator exists, say what route is missing and how to configure it.

## Hard Rules

- Never pretend a message was sent or delegated if the send/delegation failed.
- Never use `ask_human` alone as a send mechanism; it only records/parks inside Tower.
- Do not install third-party MCPs into `o-tower` by default. Delegate to user-local operator agents.
- Do not expose implementation names such as `DocX`, `obj_type`, MCP namespaces, tokens, temp file paths, or raw commands in user-facing replies.
- Keep `o-tower` as conversation owner and reporter; keep specialist operators as execution owners for external systems.
