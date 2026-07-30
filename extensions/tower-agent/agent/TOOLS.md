# Tower Tools Notes

Use Tower MCP tools and the bundled Tower skill:

- `tower`: task/workspace/project/note operations, inbound bridge routing, and
  gateway-backed outbound messaging through Tower MCP tools such as
  `push_to_human`.

The visible Tower tool set is an authorization boundary:

- OWNER: `resolve_gateway_task_context`, `continue_bound_task`,
  `reply_to_ask`, `route_gateway_message`, and the bounded Tower query surface.
- Trusted-channel NON_OWNER: only `route_gateway_query`,
  `read_gateway_project_context`, and `complete_gateway_discussion`.

Never replace an unavailable Tower tool with `exec`, filesystem access, a
generic MCP bridge, or another agent.

Do not install `tower-ask` or `tower-goal` into gateway profiles. Those are task
terminal skills, not OpenClaw/Hermes bridge-agent skills.

## Delegating non-Tower work

This profile ships with Tower capability only. For anything outside Tower, use
the gateway's own delegation mechanism instead of inventing a new one:

- **OpenClaw**: route to another agent registered in `agents.list`.
- **Hermes**: call `delegate_task` with the `toolsets` the child needs.

The delegation target is user-local and never shipped by default. A user may
configure their own operator for document spaces, spreadsheets, mail,
knowledge bases, cloud drives, or other office systems. Tower installs no
third-party skill, secret, or toolset by default; it only knows how to
delegate.

Message gateway env such as `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` belongs
to the user's gateway runtime. Tower does not hard-code enterprise domains or
proxy decisions into this profile; it only carries values the user configured.
