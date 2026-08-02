---
name: tower-bridge
description: Submit a structured external capability request from a Tower task through the configured Gateway. Use for computer, browser, SaaS, document, spreadsheet, or other operator work outside Tower. Plain human messages use tower-ask; Tower sibling-task handoff stays in the tower skill.
---

# tower-bridge - external capability boundary

Use this skill only when a Tower task needs a capability outside Tower. Tower
owns the project goal and result; OpenClaw/Hermes owns channels, credentials,
authorization enforcement, capability routing, and concrete Operator mapping.

This is a semantic boundary, not a second Gateway. Do not install external MCPs
into Tower and do not maintain a Tower-side map from capability names to agents.

## Not this skill

- Real human/group message: use `tower-ask`.
- Tower task or sibling terminal: use the `tower` skill with
  `resume_task_execution` and `send_task_terminal_input`.
- Ordinary project CRUD, status, notes, or review: use `tower`.

## CapabilityRequest v1

Form one request before dispatch. Keep it minimal and structured:

```yaml
schemaVersion: 1
requestId: "<stable UUID; reuse for the same logical action>"
capability: "<domain.resource.verb>"
lane: "DIRECT | JOB"
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

Rules:

- `capability` describes the business action, never an agent, MCP namespace,
  workspace path, shell command, or local installation detail.
- Forward only the inputs required for the action. Do not forward the whole
  terminal transcript or project history.
- The model cannot invent `authorizationRef`. R2/R3 without a valid bounded
  grant is `BLOCKED` and must be taken to the OWNER.
- Goal mode is runtime state, not authorization.
- Pick exactly one route before submission. Once accepted, timed out, or
  possibly side-effecting, never fall back to another route with the same
  action unless the authoritative status proves no submission occurred.

## Lane selection

Use `DIRECT` only for deterministic, short actions with an immediate provider
receipt, such as sending already-generated text through a configured channel.
Use `JOB` for multi-step Operator or GUI work. A timeout after a possible side
effect is `SIDE_EFFECT_UNKNOWN`, never an automatic retry.

## Dispatch

1. Call `discover_gateway_capabilities({ taskId })` and use only an advertised,
   available capability with its executable schema.
2. `human.message.send` uses `submit_capability_request`. It is fixed to the
   configured OWNER home route; never add a destination to `inputs`. R2 requires
   the `authorizationRef` returned by discovery after the user enabled
   unattended mode in Tower UI.
3. During migration, if the Gateway has no deterministic external-capability
   entry, submit the structured envelope to its Tower conversation role as one
   compatibility route. Do not address a concrete specialist from Tower.
4. Capture the Gateway's `runId`/`taskId` as `jobRef` when it creates a Job.
   OpenClaw's native `tasks show <jobRef> --json` is the read-only recovery
   authority; do not mirror its full Job state in Tower.

The compatibility route may perform one extra model turn. It remains only until
the Gateway exposes a deterministic adapter for that capability. Never execute
both routes for comparison.

For `human.message.send`, `submit_capability_request` already records the
durable ask/notification lifecycle. Do not also call `push_to_human`,
`ask_human`, or `notify_human` for the same logical message.

## Result handling

Normalize the result for the Tower task:

```yaml
requestId: "<same request id>"
status: "SUCCEEDED | FAILED | BLOCKED | CANCELLED | EXPIRED | SIDE_EFFECT_UNKNOWN"
revision: 1
summary: "<business result>"
evidence: []
jobRef: "<Gateway-owned reference when lane=JOB>"
```

Save only the project-relevant summary, evidence references, `requestId`,
`jobRef`, and latest revision. Do not copy Gateway credentials, routes, full
transcripts, or the complete external Job state into Tower.

## Hard rules

- Never pretend an action was submitted or completed.
- Never expose tokens, raw commands, temp paths, MCP namespaces, or agent IDs in
  user-facing output.
- Never translate an unknown side effect into a normal failure.
- Never let a late `RUNNING` observation overwrite a terminal revision.
- Never resume or mutate a Tower task merely because an external message was
  bound to it.
