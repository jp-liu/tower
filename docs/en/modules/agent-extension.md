---
title: Tower Agent Extension
description: How to extend o-tower with dedicated operator agents for Feishu, mail, knowledge bases, and other external systems
---

**Slug:** `agent-extension`

## Principle

`o-tower` is the Tower entrypoint and coordinator, not an all-purpose executor.

The official Tower profile stays clean by default: Tower MCP plus the `tower`
skill. External systems such as Feishu, mail, Slack, Notion, and company
knowledge bases should be configured as dedicated local operator agents, then
reached through capability routing.

Example:

```yaml
capabilityRoutes:
  tower.task: o-tower
  tower.project: o-tower
  tower.note: o-tower
  feishu.docs: xiao-fei
  feishu.wiki: xiao-fei
  feishu.sheets: xiao-fei
  feishu.bitable: xiao-fei
  feishu.drive: xiao-fei
  feishu.permissions: xiao-fei
```

`o-tower` handles Tower work directly. Feishu document pages, knowledge-base
pages, Sheets, Bitable/Base apps, Drive files, folders, attachments, and
permission checks are delegated to `xiao-fei`, which owns the Feishu MCP/skills
and user credentials.
In the Feishu example, `xiao-fei` is a Feishu workspace operator, not only a
spreadsheet operator. It can own the user's accessible company documents:
knowledge-base pages, cloud documents, ordinary Sheets, Bitable/Base apps,
Drive files, folders, attachments, and permission checks.

## Installing And Updating OpenClaw + Feishu

Tower Agent assumes OpenClaw can already receive Feishu messages. OpenClaw owns
the Feishu app, bot, permissions, and credentials; Tower's extension installer
does not install the Feishu channel. Before proceeding, verify that OpenClaw can
answer a basic message in the target group or private chat, and that addressed
messages in those chats route to the profile Tower will install (`o-tower` by
default). Configure that channel binding in OpenClaw.

### 1. Build And Start Tower

For the published npm package:

```bash
npm install -g @tower-org/cli@latest
tower
```

For a source deployment, stop the old Tower process first, then run:

```bash
pnpm install
pnpm build
pnpm start
```

Keep the new Tower process running for the remaining steps. Tower startup runs
database migrations and recovers durable gateway work and pending deliveries.

### 2. Install Or Reinject Tower Agent

1. Open **Tower -> Settings -> Extensions -> Tower gateway agent settings**.
2. Under **Tower Agent (OpenClaw)**, keep the default `o-tower` profile or enter
   the profile actually used by the Feishu channel.
3. Enter only gateway runtime environment values required by this machine.
   Tower does not prescribe proxy or `NO_PROXY` rules.
4. Click **Install** for first setup or **Update** after Tower, profile, or skill
   changes.

Update is the reinjection flow. It refreshes `SOUL.md`, `AGENTS.md`, `TOOLS.md`,
Tower MCP configuration, and the bundled `tower` skill from the currently
running Tower package. Unmanaged fields in the OpenClaw agent entry are kept.

### 3. Restart The Gateway And Refresh Feishu Sessions

Run the following in order:

```bash
openclaw gateway restart
openclaw gateway status
openclaw status --all
```

Then send the following as a standalone message in **every affected Feishu
group or private chat**:

```text
/new
```

`/new` makes that OpenClaw conversation load the newly injected profile and
skills. Send it after the gateway restart and separately in every conversation
under test. It does not remove Tower's durable queue or project bindings, and
it does not refresh a long-running Tower Workbench terminal.

The complete order is: **update and start Tower -> update/reinject Tower Agent
-> restart the OpenClaw gateway -> send `/new` in affected Feishu conversations
-> run acceptance**.

## The Four Routes

Every addressed inbound message must call `route_gateway_message` before work
begins and follow the returned mode.

| Route | Responsibility | Workbench | User task creation | Reply and persistence |
|---|---|---:|---:|---|
| `DIRECT` | Ordinary Q&A or delegation to a configured external operator | No | No | OpenClaw replies directly. Tower persists and deduplicates the inbound route, but does not claim a complete Tower-owned history of ordinary chat replies. |
| `TOWER` | Tower MCP query or simple command in the gateway | No | Not by routing itself; only an explicitly requested successful MCP mutation may create one | The gateway replies directly. Confirm a mutation only after the tool succeeds. |
| `PROJECT_DISCUSSION` | A separate project-bound Assistant discussion session | No | **No WorkItem or child task** | `complete_gateway_discussion` creates an idempotent, retryable `GatewayDelivery`, which Tower sends through OpenClaw to the original Feishu conversation. |
| `PROJECT_WORK` | Research, dispatch, and review by the project's resident Workbench | Yes, only through the durable event queue | Only after the Workbench successfully calls `create_task` | A queue acknowledgement comes first, then a separate task-created confirmation, and finally a reviewed result. |

Project discussion and project work are deliberately separate:

- Discussion reuses an independent project-bound session. It does not enter the
  Workbench or create a WorkItem, child task, or `WorkbenchEvent`.
- Only project work persists a `GATEWAY_WORK_REQUEST` in the Workbench safe-boundary queue.
- The resident Workbench is coordination infrastructure, not the task requested
  by the user.
- `queued: true` means the inbound request and Workbench event are durable. It
  **does not mean a task was created**.
- `confirm_gateway_task_created` may send a creation confirmation only after
  `create_task` returns a real task id.
- `complete_gateway_work` may send the final result only after the Workbench
  reviews the child and moves it to `DONE`.

Project resolution prioritizes reply bindings, existing thread bindings, and an
explicit project id/name/alias. If multiple candidates remain, the gateway must
ask the user to choose rather than select the highest score. Consecutive
threadless discussions reuse a chat + sender + session-kind binding; the recent
project fallback expires after seven days. Explicit thread bindings do not use
that expiry fallback.

## Feishu Channel Acceptance

Use a project name or alias that exists in Tower and is accessible to the bot.
Wait for each response before moving to the next step.

### 1. Ordinary Q&A (`DIRECT`)

Send:

```text
Explain idempotency in one sentence.
```

Expected: an ordinary Feishu answer, with no project Workbench activity or task.

### 2. Read-only Tower Query (`TOWER`)

Send:

```text
List the in-progress tasks in <project name> in Tower. Read only; do not create a task.
```

Expected: an answer from actual Tower data, with no project Workbench or new
task. An ambiguous project must produce candidates, not a guess.

### 3. Project Discussion And Same-thread Follow-up (`PROJECT_DISCUSSION`)

Send:

```text
Discuss <project name>: what is the largest risk in the current gateway design? Do not create a task.
```

Expected: a project-aware response and no WorkItem, child task, or project-work
queue event.

Reply in the same Feishu thread:

```text
Continue the previous discussion and list the top two risks in priority order.
```

Expected: the same project-bound discussion session and context are reused, and
the reply returns to the original thread. Real-channel acceptance has already
confirmed Tower queries and project discussion session reuse.

### 4. Project Work (`PROJECT_WORK`)

Send:

```text
In <project name>, do this work: add gateway acceptance documentation.
```

Accept three distinct results in this order:

1. The first response says only that the request was queued for the project
   Workbench. It must not claim that a task was created.
2. After the Workbench successfully calls `create_task`, a separate Feishu
   message contains the real task title and Tower task id. Only then verify the
   task on the Tower board or detail page.
3. After the child finishes and the Workbench accepts its review, a separate
   final message contains the reviewed summary, commit, branch, and the same
   Tower task id.

Receiving only the queue acknowledgement means acceptance is still waiting for
task creation.

## Reliable Delivery And Idempotency

Tower persists project-discussion replies, real task-created confirmations, and
final results before sending them through OpenClaw. These `GatewayDelivery`
records have stable semantic deduplication keys:

- failed sends remain `FAILED` and retry with backoff;
- Tower startup recovers stale `SENDING` claims and retries due deliveries;
- a successfully delivered semantic message is immutable and is not sent twice;
- a duplicate platform callback reuses the same inbound row, Workbench event,
  and delivery instead of replaying the action.

Ordinary `DIRECT` and `TOWER` gateway replies are not the same as these durable
Tower deliveries. The current implementation also has no complete Tower-owned
project-discussion history UI. Do not describe Notification Center as a full
audit log of all gateway conversations.

## Troubleshooting

### Queued For A Long Time Without A Real Task Confirmation

1. Do not resend the work request. A manual resend has a new Feishu message id
   and may represent a second request; only retries of the original callback are
   deduplicated.
2. Confirm the new Tower process is running. Inspect its startup/runtime logs
   for `Gateway recovery`, `Workbench`, or gateway-delivery errors.
3. Open Tower **Missions** or the project's Workbench and check the resident
   terminal. A busy terminal receives no direct write; the durable event waits
   for a completed-turn safe boundary.
4. A Workbench that remained open across the upgrade may not have loaded the
   new system directive or hooks. Stop that old execution and use the normal
   **Continue/Retry** flow to start a fresh Workbench session. The persisted
   event will drain at a safe boundary; do not recreate the work request.
5. `/new` refreshes only the OpenClaw/Feishu session. It cannot replace a
   Workbench restart. This is the characteristic case where `PROJECT_WORK`
   stays `PENDING` while Tower queries and project discussion still work.

### Recovery After A Tower Restart

At startup Tower scans `QUEUED`/`PROCESSING` project work, ensures its Workbench
is running, and retries pending or failed deliveries. After a restart, observe
the recovery logs and original Feishu thread before sending anything again.
Persistence and deduplication recover the original request; they do not create
a replacement request.

### Profile Or Skill Is Still Old

Click **Update** in Extensions, run `openclaw gateway restart`, then send `/new`
in each affected Feishu conversation. Restarting Tower alone does not refresh an
active OpenClaw session. `/new` alone does not update files or Workbench hooks.

### Tower And OpenClaw Status

```bash
openclaw gateway status
openclaw status --all
```

- **Settings -> Extensions** shows whether Tower Agent (OpenClaw) is installed
  and its package version.
- **Missions** or the project Workbench shows the resident execution/terminal.
- The Tower board/task detail verifies the real task id from a creation
  confirmation; never infer it from a queue acknowledgement.
- Tower foreground/service logs show startup recovery, queue drain, and delivery
  failures.
- Notification Center is useful for task asks and notices, but is not a complete
  history of project discussion, inbound routing, or gateway deliveries.

## Current Limitations

- Tower Agent installs Tower capability only. It does not install Feishu MCP,
  credentials, or third-party operators.
- Project discussion has a project-bound session and durable reply delivery,
  but no complete Tower-owned discussion history UI today.
- No special Feishu card style is promised. Acceptance uses actual text, the
  task id, and Tower state.
- Shared chats can be restricted with `harness.channelBindings`; do not assume a
  dedicated visual management page exists today.

## tower-bridge And tower-ask

`tower-ask` only sends or asks real humans, groups, and external communication
channels. It does not hand work to `o-tower`, `xiao-fei`, or another agent.

When a Tower task needs to send prepared content to `o-tower` so the gateway can
route it through local extensions, use `tower-bridge`:

```text
current task
-> tower-bridge
-> o-tower gateway / Tower task terminal
-> local route to xiao-fei or another operator
-> summarized result back to the current task or user
```

`tower-bridge` is a routing skill. It does not install third-party MCPs and does
not hold Feishu, mail, or knowledge-base credentials by default. It only hands
content to the right execution owner.

## OpenClaw Sketch

Create a dedicated operator workspace:

```bash
openclaw agents add xiao-fei \
  --workspace ~/.openclaw/workspaces/xiao-fei \
  --agent-dir ~/.openclaw/agents/xiao-fei/agent \
  --non-interactive
openclaw agents set-identity --agent xiao-fei --name 小飞
```

Keep allowlists narrow:

```json
{
  "agents": {
    "list": [
      {
        "id": "o-tower",
        "skills": ["tower"],
        "allowedTools": ["tower__*"]
      },
      {
        "id": "xiao-fei",
        "skills": ["feishu"],
        "allowedTools": ["feishu__*"]
      }
    ]
  }
}
```

Place local routes in:

```text
~/.openclaw/workspaces/o-tower/delegation-routes.json
```

See the copyable example:

```text
extensions/tower-agent/examples/openclaw-local-delegation-routes.json
```

Add an instruction to the `o-tower` workspace rules saying that Tower work is
direct, while `feishu.docs`, `feishu.wiki`, `feishu.sheets`, and
`feishu.bitable`, `feishu.drive`, and `feishu.permissions` are delegated to
`xiao-fei`.

## Boundaries

- Do not store app secrets, access tokens, or refresh tokens in docs, prompts,
  or route files.
- Use least privilege and a single token owner for third-party MCPs.
- Write, delete, bulk, permission-changing, and outbound-send actions should
  return a plan first unless the user already confirmed the exact action.
- Tower does not ship Feishu or other third-party integrations by default; it
  ships the delegation pattern.
- User-facing replies should use business names such as document page,
  knowledge-base page, Sheet, Bitable, Drive file, and attachment. Do not expose
  implementation names such as `DocX`, `obj_type`, MCP namespaces, tokens, temp
  file paths, or raw commands.
