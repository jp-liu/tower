# Tower Capability Bridge for OpenClaw

This optional plugin keeps concrete Operator routing inside OpenClaw. Tower
submits business capability names and receives an OpenClaw `runId`/task
reference; it never sees the configured Operator `agentId`.

The plugin also exposes `tower_sender_role`. Its per-turn tool factory reads
OpenClaw's platform-verified `senderIsOwner` value directly from trusted runtime
context and returns it as `sender_is_owner`. The agent calls this tool before
OWNER-sensitive decisions, while OpenClaw's `toolsBySender` policy remains the
actual authorization boundary.
Missing tools therefore mean that a capability is unavailable, not that a
verified OWNER has become a NON_OWNER.

Configure mappings under `plugins.entries.tower-capability-bridge.config`:

```json
{
  "capabilities": [
    {
      "name": "computer.gui.act",
      "description": "Operate a desktop application through the configured computer Operator",
      "agentId": "computer-operator",
      "risk": "R2",
      "inputSchema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["instruction"],
        "properties": {
          "instruction": { "type": "string", "minLength": 1, "maxLength": 4000 }
        }
      }
    }
  ]
}
```

The plugin exposes authenticated Gateway RPC methods
`tower.capabilities.discover` and `tower.capabilities.submit`. Job execution
uses OpenClaw's durable subagent runtime and `requestId` as the native
idempotency key. Status and recovery stay authoritative through
`openclaw tasks show <jobRef> --json`.
