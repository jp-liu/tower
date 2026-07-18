# Tower Tools Notes

Use Tower MCP tools and the bundled Tower skill:

- `tower`: task/workspace/project/note operations, inbound bridge routing, and
  gateway-backed outbound messaging through Tower MCP tools such as
  `push_to_human`.

Do not install `tower-ask` or `tower-goal` into gateway profiles. Those are task
terminal skills, not OpenClaw/Hermes bridge-agent skills.

## Delegating non-Tower work

This profile ships with Tower capability only. For anything outside Tower, use
the gateway's own delegation mechanism instead of inventing a new one:

- **OpenClaw**: route to another agent registered in `agents.list`.
- **Hermes**: call `delegate_task` with the `toolsets` the child needs.

The delegation target is user-local and never shipped by default. Example: to
handle Feishu, a user configures their own operator on their machine — an
OpenClaw `feishu-operator` agent, or a Hermes subagent with the Feishu toolsets
enabled (which also needs the user's own Feishu credentials). Tower installs no
Feishu skill, secret, or toolset by default; it only knows how to delegate.

Message gateway env such as `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` belongs
to the user's gateway runtime. Tower does not hard-code enterprise domains or
proxy decisions into this profile; it only carries values the user configured.
