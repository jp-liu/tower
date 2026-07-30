# Gateway, Workbench, And Durable Routing

## Responsibility Boundaries

Tower keeps the gateway path inside the existing monolith. It does not add a
queue service or another worker process.

| Component | Owns | Must not own |
|---|---|---|
| Gateway assistant (OpenClaw/Hermes) | Platform transport, intent classification, ordinary Q&A, external-operator delegation, Tower MCP calls | Project implementation, project review, guessing an ambiguous project |
| Project Workbench | Project context, research, task dispatch, child review, acceptance, final result wording | Platform retry state, direct injection while its PTY is busy |
| Durable Coordinator | Persistent inbound/event/delivery state, deduplication, safe-boundary queueing, retry and restart recovery | Intent classification or project decisions |

Ordinary questions and external extension operations remain in the gateway.
Tower queries and simple mutations run through MCP in the gateway. Only project
work enters the resident Workbench. Project discussion uses a separate
project-bound discussion session, so it cannot block on a busy Workbench PTY.

## Persistence

The gateway layer adds no replacement for `Task`, `WorkItem`, or `TaskGroup`.
`Task` remains the only unit of work.

- `GatewaySession` binds `gateway + platform + chat + thread/root message` to a
  project. `WORKBENCH` sessions also point to the resident Tower task;
  `DISCUSSION` sessions point to an independent project-bound Assistant session.
- `GatewayInbound` is the deduplicated inbound envelope and queue state. Its
  stable key includes gateway, platform, chat, and platform message id.
- `GatewayDelivery` is an idempotent, retryable reply to the original channel.
  Queue acknowledgements, creation confirmations, discussion responses, and
  final results each have a stable semantic deduplication key. Both the text
  fallback and native-card payload are persisted for stable retries.
- `HarnessDelivery` remains the compatibility mapping for
  `[[tower:task=...]]`, parked asks, and work-channel task replies.
- `WorkbenchEvent` remains the only durable inbox that can inject project work
  into a Workbench PTY.

## Channel Policy

Channel routing policy is stored in `harness.channelBindings`:

```json
[
  {
    "gateway": "openclaw",
    "platform": "feishu",
    "chatId": "oc_example",
    "defaultWorkspaceId": "workspace-id",
    "allowedProjectIds": ["project-a", "project-b"],
    "defaultProjectId": "project-a"
  }
]
```

`defaultWorkspaceId` scopes discovery, `allowedProjectIds` is an allowlist when
non-empty, and `defaultProjectId` is optional. A large group can allow many
projects without choosing a default project.

## Project Resolution

`route_gateway_message` resolves project context in this exact order:

1. replied-to delivery, explicit task id, or `[[tower:task=...]]` binding;
2. existing thread/root-message session binding;
3. exact user-supplied project id, name, or alias;
4. a single `identify_project` scoring match;
5. the sender's most recently active allowed project session;
6. the channel's optional default project.

OpenClaw keeps ordinary Q&A and external-operator requests outside Tower.
`route_gateway_message` receives only Tower operations, project discussions,
and project work. Old clients may still send `DIRECT`, but Tower returns
`direct_not_supported` before creating a `GatewayInbound` row. `startNewWork=true`
is reserved for an explicit create-new-task/start-new-work request and overrides
an old task reply binding. `sessionAction=NEW` skips the old discussion binding
for an explicit fresh discussion or project switch.

Every step is constrained by the channel workspace and project allowlist. More
than one remaining match returns candidates and requires selection. No route is
allowed to choose the highest-scored candidate when alternatives remain.

Threadless messages use a stable chat + sender + session-kind anchor. This
preserves one discussion Assistant session for consecutive messages from the
same person while preventing participants in a group chat from sharing context.
Sender-based session/recent-project lookup expires after seven days; an old
project is never selected silently forever. Explicit thread/root bindings do
not use this recency fallback.

## Discussion History And Lifecycle

Each `PROJECT_DISCUSSION` inbound creates a Tower-owned `AssistantTurn` with
paired user and assistant `AssistantMessage` rows. Each route restores the
latest configurable `assistant.historyTurns` completed turns, bounded to 12,000
characters, and reports when older context was truncated. Stored history is
bounded to 100 completed turns per discussion.

Completing a reply settles the turn and releases per-turn execution resources,
while its `GatewaySession` binding remains durable. Tower/OpenClaw restarts do
not erase it, and replying to an old delivered discussion card can reactivate a
closed binding. Creating a task does not close a discussion. Use
`sessionAction=CLOSE` for an explicit Tower-side close and `sessionAction=NEW`
for a fresh discussion/project switch. OpenClaw `/new` is not a Tower close
signal and is never relied on for this lifecycle.

Duplicate Tower inbound callbacks never replay an actionable route. `QUEUED` or live
`PROCESSING` rows return `in_progress` with `noOp: true`; `PROCESSED` rows return
`already_processed` with `noOp: true`. Only stale project-discussion generation
can return its original action again. Task replies are never lease-replayed:
terminal relay has no persistent injection checkpoint, so every duplicate stays
a no-op even after the claim lease expires. Durable Workbench work also remains
a no-op and is recovered through the coordinator path.

## Workbench Queueing

`PROJECT_WORK` creates or reuses the project's resident Tower task, persists the
inbound envelope, and enqueues one `GATEWAY_WORK_REQUEST` event. The Workbench is
then started or resumed idempotently.

- A live busy Workbench receives no direct PTY write. The event remains pending
  until `openWorkbenchDrainBoundary` observes a completed turn.
- The live PTY separately retains an authoritative `BUSY`/`IDLE` turn state:
  every input marks it busy and a provider Stop/turn-complete callback marks it
  idle. If a Tower route/module restart loses only the disposable drain token,
  startup recovery recreates that token for `already_running + IDLE`; it never
  infers safety from a quiet buffer or injects into `already_running + BUSY`.
- A stopped Workbench is started or resumed, but the durable event still waits
  for that safe boundary.
- Startup recovery reopens Workbenches with queued requests, restores one safe
  drain boundary for a newly started/continued PTY or a live idle PTY, and
  retries pending or failed outbound deliveries.
- A repeated platform callback reuses the same inbound row, Workbench event,
  and delivery rows.

## Confirmation And Completion

The Workbench prompt carries the stable gateway inbound id.

1. The Workbench calls `create_task`.
2. Only after the call returns a real task id may it call
   `confirm_gateway_task_created`. Tower validates the caller is the bound
   Workbench and the task belongs to the bound project before sending a
   confirmation card from server data: title, project, priority, status,
   workspace, branch, task id, goal, and whether execution auto-started.
3. Child completion enters the existing durable review inbox.
4. After review, the Workbench moves the accepted child to `DONE` and calls
   `complete_gateway_work`.
5. Tower validates the Workbench, task, project, and status, then replies to the
   original message/thread with title, reviewed summary, commit id/message,
   branch, and Tower task id.

All four durable cards reply to the current inbound `platformMessageId` while
preserving `threadId`; later rounds never pin their reply to the thread root.
Failed sends remain `FAILED` with exponential retry time. The earliest due
delivery owns one process-local `unref` timer; additional failures only move
that timer earlier and cannot create concurrent retry loops. Startup recovery
also schedules future rows and recovers stale `SENDING` claims. Successful
semantic deliveries are immutable and repeated calls never send twice.

## Legacy Reply Compatibility

Inbound replies that reference `HarnessDelivery` or contain
`[[tower:task=...]]` first call `resolve_gateway_task_context`. Resolution is
read-only and returns task status, the OPEN ask (if any), project context, and
the latest execution summary. An OPEN ask is answered with `reply_to_ask`.
Status/result questions use read-only Tower tools, and external-system work is
delegated with the returned context without changing Tower. Only an explicit
continue/fix/rerun instruction calls OWNER-only `continue_bound_task`.

`continue_bound_task` reuses the existing `GatewayInbound` platform-message
deduplication key. It does not add a second idempotency table. The first callback
may continue or start the task and inject the instruction; repeated callbacks
are no-ops. If an OPEN ask exists, continuation is refused so the answer cannot
be bypassed. `relay_channel_reply` remains a compatibility entry: it can answer
an OPEN ask, but an ordinary reply only returns context and never resumes or
injects into a terminal.
