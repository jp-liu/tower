---
name: tower-bridge
description: Route Gateway-mediated external operations, including messages to a named human or group, unattended OWNER messages, user-session computer or browser control, SaaS, documents, spreadsheets, and other operator work. Use when a Tower task must communicate with a real recipient or invoke a capability that depends on Gateway-owned channels, credentials, sessions, or Operators. Do not use for ordinary task-terminal shell, filesystem, Git, build, or test work; keep sibling task handoff and Tower CRUD in the tower skill.
---

# tower-bridge - external capability boundary

Use this bridge for every Gateway-mediated external operation. The boundary is
crossed when work needs a real recipient or a Gateway-owned channel, credential,
user session, capability route, or Operator. Tower owns the task, goal, ask/park
lifecycle, and project-relevant result. OpenClaw/Hermes owns the external route.

Keep the task terminal's development execution plane direct: use its normal
shell and tools for workspace files, Git, package managers, builds, tests, and
local databases. Network access alone does not trigger this skill; repository
operations remain governed by the task's Git and safety rules. Requiring human
consent for a risky terminal command also does not by itself make it a bridge
operation.

Do not install external MCPs into Tower or maintain a Tower-side map from
capability names to agents.

## Choose one request type

### Human message

Normalize all outbound messages as `human.message.send`, then choose exactly
one recipient mode:

| `recipientMode` | Trigger | Destination | Dispatch |
|---|---|---|---|
| `explicit` | The user explicitly names a person or group | `to` is required and comes only from the user's instruction | `list_notify_targets(scope: "work")`, then `push_to_human` |
| `owner_home` | An unattended Goal needs its OWNER | Fixed configured OWNER route; `to` is forbidden | `discover_gateway_capabilities`, then one authorized `submit_capability_request` |

Both modes also carry `message`, `expectReply`, and a stable idempotency key:
use `dedupKey` for `push_to_human` and UUID `requestId` for
`submit_capability_request`.

#### Explicit recipient

1. Call `list_notify_targets({ taskId, scope: "work" })`.
2. Call:

```text
push_to_human({
  taskId,
  message,
  scope: "work",
  to,
  expectReply,
  dedupKey
})
```

- `expectReply: true` sends, records an ask, and parks.
- `expectReply: false` sends and records a notification.
- If delivery fails, do not call `ask_human`; nobody received the question.
- Preserve the returned `[[tower:task=<id>]]` correlation token.

#### Unattended OWNER

1. Call `discover_gateway_capabilities({ taskId })` and inspect
   `human.message.send`.
2. Submit one `DIRECT / R2` request with the UI-issued `authorizationRef`:

```yaml
schemaVersion: 1
requestId: "<stable UUID>"
capability: human.message.send
lane: DIRECT
risk: R2
authorizationRef: "<from discovery>"
inputs:
  message: "<message>"
  expectReply: true
expectedOutput:
  summary: true
  evidence: []
towerContext:
  taskId: "<TOWER_TASK_ID>"
constraints: []
```

Never put `to`, a platform destination, or an agent id in this envelope. The
OWNER route is fixed outside the task. Do not duplicate the message through
`push_to_human`, `ask_human`, `notify_human`, or a platform MCP.

When `expectReply=true` succeeds, end the turn immediately. Tower parks the
task and resumes it when the reply is durably bound.

## Other external capabilities

If the current task does not already have an authorized executable route, do
not ask the user to pre-authorize a generic GUI capability in Tower. Send one
OWNER question describing the exact external operation, set `expectReply:
true`, and park. Ask the OWNER to approve execution by OpenClaw. The Gateway
handles an affirmative reply by executing that one quoted operation and
returns the validated result through `reply_to_ask`; continue from that result.
Do not treat a bare approval injected into the terminal as an
`authorizationRef`, and do not submit the same operation again from Tower.

When a valid request-specific grant already exists, form one
`CapabilityRequest v1` before dispatch:

```yaml
schemaVersion: 1
requestId: "<stable UUID; reuse for the same logical action>"
capability: "<domain.resource.verb>"
lane: JOB
risk: "R0 | R1 | R2 | R3"
authorizationRef: "<trusted grant reference; omit when none exists>"
inputs: {}
expectedOutput:
  summary: true
  evidence: []
towerContext:
  taskId: "<TOWER_TASK_ID>"
  projectId: "<when known>"
constraints: []
```

- Use only an advertised capability and its executable schema.
- `capability` names a business action, never an agent, MCP namespace,
  workspace path, command, or installation detail.
- R2/R3 requires a valid bounded grant. The model cannot invent
  `authorizationRef`; Goal mode alone is not authorization.
- In the current contract, `DIRECT` is reserved for
  `human.message.send / R2`. Submit every other advertised external capability
  using its discovered `JOB` lane.
- Pick one route before submission. Never execute a compatibility route and a
  deterministic adapter for comparison.

## Result handling

Keep only the project-relevant summary, evidence references, `requestId`,
`jobRef`, and latest revision:

```yaml
requestId: "<same request id>"
status: "SUCCEEDED | FAILED | BLOCKED | CANCELLED | EXPIRED | SIDE_EFFECT_UNKNOWN"
revision: 1
summary: "<business result>"
evidence: []
jobRef: "<Gateway-owned reference when lane=JOB>"
```

OpenClaw's native task status is the read-only recovery authority. Do not copy
its credentials, full transcript, route, Operator identity, or complete Job
state into Tower.

## Boundaries

- Tower sibling task: use the `tower` skill with `resume_task_execution` and
  `send_task_terminal_input`.
- Tower CRUD, status, notes, or review: use the `tower` skill.
- Task-terminal shell, filesystem, Git, dependency, build, test, and local
  database work: execute directly in the terminal under project rules.
- Browser/computer control means an external user session or Operator-managed
  GUI, not ordinary terminal commands.
- Never claim an action was submitted or completed without an authoritative
  receipt or result.
- Never expose tokens, destinations, local paths, commands, MCP namespaces, or
  agent ids in user-facing output.
- `SIDE_EFFECT_UNKNOWN` is terminal: do not retry or fall back.
- A late `RUNNING` observation cannot overwrite a terminal revision.
- Binding an external message to a Tower task never authorizes terminal resume.
