# Tower Tools Notes

Use Tower MCP tools and the bundled Tower skill:

- `tower`: task/workspace/project/note operations, inbound bridge routing, and
  gateway-backed outbound messaging through Tower MCP tools such as
  `push_to_human`.

Do not install `tower-ask` or `tower-goal` into gateway profiles. Those are task
terminal skills, not OpenClaw/Hermes bridge-agent skills.

Message gateway env such as `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` belongs
to the user's gateway runtime. Tower does not hard-code enterprise domains or
proxy decisions into this profile.
