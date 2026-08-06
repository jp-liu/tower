---
title: Automation responsibilities
description: The distinct roles of Gateway, Workbench, the durable protocol, MCP, and extensions
---

# Automation responsibilities

Tower separates where a message enters, who coordinates project work, how responsibility survives restarts, how tools are called, and how AI providers execute. These layers compose, but they are not interchangeable.

## Responsibility map

| Name | Owns | Does not own |
|---|---|---|
| **Gateway** | External ingress, verified sender and scope, Tower route selection, and delivery back to the source channel | Repository changes or project reasoning |
| **Workbench** | The resident coordinator for one project: project-aware discussion, explicit task creation, and child-result review | Chat transport or the implementation task itself |
| **Durable protocol** | Inbox, batches, ACK, leases, heartbeats, and completion records that preserve responsibility across processes | Business decisions or channel behavior |
| **MCP** | Bounded Tower tools for AI clients, including project queries, task mutations, and terminal control | External chat connections |
| **OpenClaw integration** | OpenClaw profile injection, Tower MCP, skills, and channel authorization through Gateway | Tower's source of truth |
| **AI Provider extension** | A common execution contract for Claude Code, Codex, Gemini, Qwen, and API providers | Gateway authorization or Workbench scheduling |

## Request flow

```text
External channel
  -> OpenClaw or another adapter
  -> Gateway (identity, authorization, routing)
  -> durable inbox + Workbench event
  -> project Workbench (discussion or work coordination)
  -> Tower MCP / child terminal
  -> durable completion + outbox
  -> Gateway
  -> original message thread
```

A simple Tower query can finish at the Gateway layer. Project discussion enters Workbench but creates no task. Workbench creates and supervises a child task only after an explicit request to create, fix, or execute work.

## Why a durable protocol exists

An in-process function return does not prove that responsibility survives a restart. The durable protocol records both pending work and ownership in the database:

- `ACK` means a Workbench accepted a batch; it does not mean the business request is complete.
- `lease + heartbeat` prevents two runtimes from processing the same responsibility.
- `RESOLVED` means the batch was handled or durably delegated.
- completion/outbox separates business completion from channel delivery, so a temporary channel outage does not roll back completed work.

This is internal reliability machinery. The UI only needs status, pending count, and heartbeat; internal generation numbers are not user-facing information.

## Continue reading

- [Workbench coordinator](/en/modules/workbench-gateway)
- [Gateway responses](/en/modules/gateway-cards)
- [MCP tool protocol](/en/modules/mcp)
- [Harness unattended runtime](/en/modules/harness)
- [OpenClaw integration](/en/modules/agent-extension)
- [CLI Provider development](/en/guide/cli-provider-sdk)
