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
3. The resident Workbench receives a durable batch and explicitly ACKs it.
4. Workbench creates the unique `GatewayTaskLink`, then starts the child task.
5. After the child enters `IN_REVIEW`, Workbench verifies the original
   constraints and evidence.
6. `Task=DONE` and `FINAL_RESULT/PENDING` are committed atomically.
7. The outbox replies to the original platform message and deduplicates with a
   stable semantic key.

## Reliability invariants

- One inbound can bind at most one external work task.
- Writing text to a PTY does not consume an event; only an ACK advances the
  checkpoint.
- After a restart, Tower recovers from the SQLite inbox/outbox rather than a
  terminal screen or in-memory state.
- A `REVIEW_ONLY` project cannot create an executable task or start a terminal.
- OpenClaw ingress receives only routing, read-only query, and diagnostic tools.
- Sender, chat, and trusted-channel queue limits prevent resource exhaustion.

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
  redacted logs.
- Missions Workbench card: inspect generation, heartbeat, batch, and block
  reasons.
- `tower service status`: inspect the operating-system service.

## Related diagrams

- [Access and permission routing sequence](/diagrams/o-tower-access-routing-sequence.drawio.png)
- [Reliable Workbench architecture](/diagrams/workbench-reliable-architecture.drawio.png)
- [Batch state machine](/diagrams/workbench-batch-state-machine.drawio.png)
