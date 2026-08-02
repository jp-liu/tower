# Tower Capability Bridge for OpenClaw

This optional plugin keeps concrete Operator routing inside OpenClaw. Tower
submits business capability names and receives an OpenClaw `runId`/task
reference; it never sees the configured Operator `agentId`.

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
