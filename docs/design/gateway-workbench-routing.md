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
  Creation confirmations, discussion responses, and final results each have a
  stable semantic deduplication key.
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

Every step is constrained by the channel workspace and project allowlist. More
than one remaining match returns candidates and requires selection. No route is
allowed to choose the highest-scored candidate when alternatives remain.

## Workbench Queueing

`PROJECT_WORK` creates or reuses the project's resident Tower task, persists the
inbound envelope, and enqueues one `GATEWAY_WORK_REQUEST` event. The Workbench is
then started or resumed idempotently.

- A live busy Workbench receives no direct PTY write. The event remains pending
  until `openWorkbenchDrainBoundary` observes a completed turn.
- A stopped Workbench is started or resumed, but the durable event still waits
  for that safe boundary.
- Startup recovery reopens Workbenches with queued requests and retries pending
  or failed outbound deliveries.
- A repeated platform callback reuses the same inbound row, Workbench event,
  and delivery rows.

## Confirmation And Completion

The Workbench prompt carries the stable gateway inbound id.

1. The Workbench calls `create_task`.
2. Only after the call returns a real task id may it call
   `confirm_gateway_task_created`. Tower validates the caller is the bound
   Workbench and the task belongs to the bound project before sending a
   confirmation with title and Tower task id.
3. Child completion enters the existing durable review inbox.
4. After review, the Workbench moves the accepted child to `DONE` and calls
   `complete_gateway_work`.
5. Tower validates the Workbench, task, project, and status, then replies to the
   original message/thread with title, reviewed summary, commit id/message,
   branch, and Tower task id.

Failed sends remain `FAILED` with exponential retry time. A stale `SENDING`
claim is recovered after restart. Successful semantic deliveries are immutable
and repeated calls return the prior result without sending twice.

## Legacy Reply Compatibility

Inbound replies that reference `HarnessDelivery` or contain
`[[tower:task=...]]` still use the existing ask/reply path. `expectReply=true`
answers the parked ask; work-channel deliveries inject into the bound task
conversation. Messages without an open ask continue through normal gateway
routing instead of consuming an unrelated parked question.
