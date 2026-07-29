# Tower Agent Extension Package

This package contains the Tower assistant profile installed into OpenClaw or
Hermes from **Tower -> Settings -> Extensions**. This guide uses OpenClaw +
Feishu for the end-to-end example.

Tower owns the task-management contract, MCP config, Tower skill, durable
project routing, and retryable channel deliveries. OpenClaw owns the Feishu
transport, model/provider, runtime, and third-party operator configuration.
Tower does not install the Feishu channel or its credentials.

The installer creates or refreshes the `o-tower` profile by default, including:

- `SOUL.md`, `AGENTS.md`, and `TOOLS.md`;
- Tower MCP configuration;
- the gateway-facing `tower` skill;
- only the runtime environment values entered by the installer.

It does not set a model, fallback model, provider, or hard-coded proxy rule.

## Install Or Update OpenClaw + Feishu

Before starting, make sure OpenClaw already receives and answers a basic message
from the target Feishu bot, and that addressed messages in the affected chats
are routed to the profile that Tower will install (`o-tower` by default).
Configure that channel binding in OpenClaw, not in Tower.

### 1. Build And Start Tower

For the published CLI:

```bash
npm install -g @tower-org/cli@latest
tower
```

For a source checkout, stop the old Tower process, then run:

```bash
pnpm install
pnpm build
pnpm start
```

Keep the new Tower process running. Startup performs database migrations and
recovers durable gateway work and pending outbound deliveries.

### 2. Install Or Refresh Tower Agent

1. Open **Tower -> Settings -> Extensions -> Tower gateway agent settings**.
2. Under **Tower Agent (OpenClaw)**, keep the default profile `o-tower` or enter
   the profile used by the Feishu channel.
3. Add only gateway runtime environment values that this machine needs.
4. Click **Install** on the first setup or **Update** after a Tower upgrade.

Update is also the supported reinjection flow. It overwrites the managed
profile files, MCP config, and bundled `tower` skill with the versions from the
currently running Tower package. It preserves unrelated OpenClaw agent fields.

### 3. Restart And Refresh Sessions

Run these steps in order:

```bash
openclaw gateway restart
openclaw gateway status
openclaw status --all
```

Then send this as a standalone message in **each affected Feishu conversation**:

```text
/new
```

`/new` starts a fresh OpenClaw conversation so that it loads the updated
profile and skills. Do it after the gateway restart, and do it separately in
every group or private chat being tested. It does not delete Tower's durable
queue or project bindings. It also does not refresh an already-running Tower
Workbench terminal; see troubleshooting below.

## Routing Contract

Every addressed inbound message, including `DIRECT`, is persisted and
classified through `route_gateway_message` before work begins. "Do not query
Tower" never bypasses this routing call.

| Intent | Owner | Enters Workbench | Creates a user task | Reply and persistence |
|---|---|---:|---:|---|
| `DIRECT` | OpenClaw, or a configured external operator | No | No | Ordinary gateway reply. Tower deduplicates the inbound route, but does not claim a complete durable history of ordinary chat replies. |
| `TOWER` | `o-tower` through Tower MCP | No | Not by routing itself | Query or simple mutation runs in the gateway. Confirm a mutation only after its MCP call succeeds. |
| `PROJECT_DISCUSSION` | A separate project-bound Assistant session | No | No | Each turn is stored in `AssistantMessage`; a native-card reply is persisted and anchored to the current inbound message. |
| `PROJECT_WORK` | The project's resident Workbench | Yes, through a durable event | Only after the Workbench successfully calls `create_task` | Native queue card first; a real-data task-created card follows, then a reviewed final-result card. |

Project discussion never creates a WorkItem, child task, or Workbench queue
event. Project work is the only route that enters the durable Workbench event
queue. The resident Workbench itself is infrastructure and is not the requested
user task.

## Owner and trusted-channel enforcement

Tower's OpenClaw installer can write an `accessPolicy` with platform owner IDs
and trusted channel IDs. OpenClaw enforces those identities before routing and
uses per-agent `toolsBySender` to expose two surfaces on the same `o-tower`
profile:

- OWNER: all Tower tools;
- trusted-channel NON_OWNER: `route_gateway_query`,
  `read_gateway_project_context`, and `complete_gateway_discussion` only.

Unknown DMs and groups do not route to o-tower. Removed groups are removed from
the managed profile bindings on update, so stale authorization does not remain.
Tower does not infer owner identity from prompts.

The owner-only surface also includes correlated request diagnostics, scoped
recovery, redacted OpenClaw/Hermes health logs, and the remote Git project
provisioner. Remote provisioning requires an explicit workspace and absolute
local root, does not install dependencies or execute repository scripts, and
defaults to `REVIEW_ONLY`.

PTY delivery is not treated as consumption. A durable batch remains
`DISPATCHED` until the bound Workbench calls `ack_workbench_batch`; the inbox
events become `CONSUMED` in that acknowledgement transaction. The Workbench
calls `resolve_workbench_batch` after all items are handled or durably
delegated. An unacknowledged batch is returned to pending after 120 seconds.

For project work, **queued is not created**. The initial result only means Tower
persisted the inbound request and its `GATEWAY_WORK_REQUEST`. A task exists only
after the separate confirmation contains its real Tower task id.

Recent discussion context uses the configurable `assistant.historyTurns`
window and reports truncation. An explicit "结束 Tower 讨论" maps to
`sessionAction=CLOSE`; starting fresh or switching projects maps to
`sessionAction=NEW`. OpenClaw `/new` reloads only its own conversation and does
not close Tower history. An old card reply can restore its persisted discussion.
Explicit new-task/start-new-work requests set `startNewWork=true` and override
an old task-card binding; ordinary follow-ups still route to that task.

## Feishu Acceptance Script

Use a project name or alias that exists in Tower. If Tower returns project
candidates, select one; it must not guess an ambiguous project.

1. Send: `请用一句话解释什么是幂等。`
   Expected: a normal answer in Feishu, with no Workbench activity or task.
2. Send: `查询 Tower 中 <项目名> 当前进行中的任务，只读，不要创建任务。`
   Expected: a Tower-backed answer, with no project Workbench or new task.
3. Send: `讨论 <项目名>：当前网关方案最大的风险是什么？不要创建任务。`
   Expected: a project-aware discussion reply and no WorkItem/child task.
4. Reply in the same Feishu thread: `继续上一条，按优先级列出两个风险。`
   Expected: the same project discussion session and context are reused.
5. Send: `在 <项目名> 中处理一项工作：补充网关验收文档。`
   Expected first: only a queued acknowledgement. Expected later: a separate
   creation confirmation containing the real title and Tower task id.
6. Wait for the child task to finish and for the Workbench to review it.
   Expected last: a separate final result containing the reviewed summary,
   commit, branch, and the same Tower task id.

Do not resend step 5 while it is queued. A manual resend has a new Feishu
message id and can represent a second request even though duplicate callbacks
for the original message are idempotent.

## Reliability And Recovery

Tower persists queue acknowledgements, project-discussion replies, task-created
confirmations, and final results before sending them through OpenClaw. Each has a stable semantic
deduplication key. Failed sends are retried, stale send claims are recovered,
and successful deliveries are not sent twice. Native-card payloads and current
message reply anchors stay identical on retry.

Tower also persists project-work inbound state and Workbench events. On Tower
startup it reopens Workbenches for queued requests, restores a safe drain
boundary, and retries pending or failed deliveries. Therefore, after a Tower restart, wait for recovery instead of
submitting the same request again.

## Troubleshooting

### Queued But No Task Confirmation

- Do not interpret the queue acknowledgement as task creation, and do not
  immediately send the request again.
- Confirm the new Tower process is still running and inspect its startup/runtime
  logs for `Gateway recovery` or `Workbench` errors.
- Open Tower **Missions** or the project Workbench and check whether its resident
  terminal is running. A busy Workbench receives the event only at a completed
  turn boundary.
- Tower restart recovery starts or continues the Workbench and opens the safe
  drain boundary automatically. A queued request should not require a manual
  Stop/Continue cycle; inspect recovery logs if it remains pending.

### Old Profile Or Skill Is Still Active

Click **Update** for Tower Agent (OpenClaw), restart the gateway, and send `/new`
in the affected Feishu conversation. Restarting Tower alone does not reload an
OpenClaw session; `/new` alone does not update files or restart a Workbench.

### Status Checks

```bash
openclaw gateway status
openclaw status --all
```

In Tower, use **Settings -> Extensions** for injected profile status,
**Missions** or the project Workbench for resident execution status, and the
task board/detail page to verify a confirmed task id. The Notification Center
is useful for task asks/notices, but it is not a complete Tower-owned history of
all project discussions or gateway deliveries.

## Delegation, not integration

The profile is Tower-only by default. It does not bundle Feishu, Notion, Slack,
or any third-party office integration, and it never requires third-party
secrets or skills to install.

For non-Tower work the agent delegates through the gateway's own mechanism:
OpenClaw routes to another agent in `agents.list`; Hermes spawns a subagent via
`delegate_task` with the needed `toolsets`. Any external operator is configured
by the user locally and is never part of the default install. See
`agent/AGENTS.md` and `agent/TOOLS.md` for the delegation rules.

## Extension Guide

Tower's docs can show concrete examples for advanced users who want to add
their own local operators for document spaces, spreadsheets, mail, knowledge
bases, or other office systems. Those examples are documentation only: Tower's
default agent profile stays Tower-only and does not ship concrete third-party
agent names, credentials, route files, or skills.

Recommended boundary for any local extension:

- `o-tower` directly operates Tower only.
- User-local operators own third-party execution.
- Capability routes for external systems point to user-local operators; Tower
  capabilities such as `tower.task`, `tower.project`, and `tower.note` stay on
  `o-tower`.
- User-facing replies should use business names such as "文档页面", "知识库页面",
  "表格", "多维表格", "云盘文件", or "附件"; do not expose implementation names,
  MCP namespaces, tokens, or temp file paths.
- write/delete/bulk/permission-changing actions return a plan first unless the
  user has explicitly confirmed the exact write.

Restart or reload the gateway after changing agent config.

For the longer operator setup and the same contract, see the
[Chinese guide](../../docs/modules/agent-extension.md) and
[English guide](../../docs/en/modules/agent-extension.md).
