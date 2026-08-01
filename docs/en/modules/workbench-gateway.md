---
title: Reliable Workbench Gateway
description: A durable, scoped loop from external messages to reviewed Tower results
---

# Reliable Workbench Gateway

The Workbench gateway connects Feishu, WeChat, and platforms supported by
OpenClaw/Hermes to Tower while preserving identity, project scope, task
ownership, and the original reply thread.

![o-tower target architecture](/diagrams/o-tower-personal-assistant-target-architecture.drawio.png)

[Download the editable Draw.io source](/diagrams/o-tower-personal-assistant-target-architecture.drawio)

## Capability boundaries

### OWNER

The bot owner may:

- query workspaces, projects, tasks, and runtime status;
- start a project discussion;
- route work to the resident project Workbench;
- use diagnostics to inspect an external message chain.

The message ingress does not receive `create_task`, task mutation, or terminal
start tools. Every write must be performed by the bound project Workbench,
preventing the ingress agent from bypassing review and creating duplicates.

### NON_OWNER

Colleagues may only query projects in the workspace bound to a trusted channel:

- a missing workspace scope fails closed;
- personal tasks, personal daily reports, and local paths are never returned;
- tasks cannot be created, changed, started, or deleted;
- unknown channels and unverifiable identities receive a permission error.

## Request classes

| Class | Behavior | Creates a task |
|---|---|---|
| `GENERAL` | General conversation or content unrelated to Tower | No |
| `PROJECT_DISCUSSION` | Answers with project history and read-only context | No |
| `PROJECT_WORK` | Persists the inbound event and dispatches it to Workbench | After Workbench review |
| `REMOTE_PROJECT` | Adds a Git project after the OWNER provides its destination | Depends on access mode |

## Reliable work loop

![Workbench gateway sequence](/diagrams/workbench-gateway-sequence.drawio.png)

[Download the editable Draw.io source](/diagrams/workbench-gateway-sequence.drawio)

1. A verified platform event carries stable sender, chat, and message IDs.
2. Tower persists `GatewayInbound` before sending the queued card.
3. The resident Workbench receives a leased, fenced durable batch and
   explicitly ACKs it.
4. Workbench creates the unique `GatewayTaskLink`, then starts the child task.
5. After the child enters `IN_REVIEW`, Workbench verifies the original
   constraints and evidence.
6. `Task=DONE` and `FINAL_RESULT/PENDING` are committed atomically.
7. The outbox replies to the original platform message and deduplicates with a
   stable semantic key.
8. Associated events become `CONSUMED` only after
   `resolve_workbench_batch` succeeds.

## Reliability invariants

- One inbound can bind at most one external work task.
- Neither a PTY write nor ACK finally consumes an event; only `RESOLVED`
  releases processing responsibility.
- `CLAIMED`, `DISPATCHED`, and `ACKED` are leased. An expired lease replays the
  same batch ID safely.
- ACK, heartbeat, and resolve carry the current generation's lease token, so a
  stale terminal cannot confirm a newer delivery.
- An unresolved batch renews its lease every two minutes instead of waiting for
  the five-minute processing lease to expire.
- After a restart, Tower recovers from the SQLite inbox/outbox rather than a
  terminal screen or in-memory state.
- Unattended human messages persist a `HarnessOutbound` and ask intent before a
  worker sends them.
- Implicit content deduplication covers only the current ask lifecycle. The same
  question starts a new send cycle after the previous ask is answered, while an
  explicit dedup key remains strictly idempotent.
- `GatewayTaskLink` references both the inbound and task with cascading cleanup;
  recovery never treats an orphan link as proof that a task exists.
- One Tower database admits one runtime leader at a time, preventing competing
  scanners from owning the same PTYs.
- A `REVIEW_ONLY` project cannot create an executable task or start a terminal.
- OpenClaw ingress receives only routing, read-only query, and diagnostic tools.
- Sender, chat, project, Workbench, and global queue limits prevent resource
  exhaustion.

## Operational data lifecycle

The lifecycle distinguishes three kinds of data:

- `WorkbenchEvent.payload` is replay input. A `CONSUMED` event may be requeued
  during recovery, so V1 retains every payload in full.
- `WorkbenchBatch.prompt` and the message bodies in `GatewayInbound` and
  `GatewayDelivery` are operational duplicates. They become possible
  compaction candidates only after the protocol is demonstrably settled.
- The small identity fields in `WorkbenchEvent`, `WorkbenchBatch`,
  `GatewayInbound`, `GatewayDelivery`, and `GatewayTaskLink` are idempotency
  tombstones. Consumption alone never permits deleting them.

Tower performs read-only observation from the existing six-hour Harness sweep;
it adds no timer. The candidate windows are `RESOLVED > 24h` for Workbench and
seven days for Gateway. A processed inbound must have no non-`DELIVERED`
delivery, and a delivered row must still reference a `PROCESSED` inbound.
`SENT_UNVERIFIED`, active, failed, and retryable states are never considered
settled.

On 2026-08-01, a real local database contained only 70,062 eligible text bytes,
about 0.16% of its 44.9 MB file. The current version therefore records rows and
byte totals by state plus eligible rows and bytes, but **does not compact or
delete data**. Logs never include message bodies. A future mutation requires
new growth evidence and another review of the atomic state and relation guards.

This is not a sensitive-data erasure guarantee. The same content may remain in
`TaskMessage`, terminal logs, application logs, and backups under their own
retention policies. Existing architecture diagrams remain correct because no
ownership boundary, relation, or data flow changed.

## Remote project modes

| Mode | Capability |
|---|---|
| `REVIEW_ONLY` | Clone, read, index, discuss, and generate a review report; untrusted scripts cannot start |
| `FULL_WORK` | After an explicit OWNER upgrade, dependencies, code changes, and commits are allowed |

Git URLs are normalized into a unique `repositoryKey`, so concurrent requests
for the same repository converge on one project. Tower asks for the workspace
and local root when the owner did not provide them.

## Diagnostics

- `diagnose_gateway_request`: inspect the stage timeline by inbound or platform
  message ID.
- `get_gateway_runtime_health`: inspect Tower and OpenClaw/Hermes health with
  redacted logs, the runtime leader, leased batches, and Harness outbox state.
- Missions Workbench card: inspect generation, heartbeat, batch, and block
  reasons.
- `tower service status`: inspect the operating-system service.

## Related diagrams

- [Access and permission routing sequence](/diagrams/o-tower-access-routing-sequence.drawio.png)
- [Reliable Workbench architecture](/diagrams/workbench-reliable-architecture.drawio.png)
- [Batch state machine](/diagrams/workbench-batch-state-machine.drawio.png)
- [Unattended outbound outbox](/diagrams/harness-outbox-state-machine.drawio.png)
