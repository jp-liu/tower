# Tower Agent Extension Package

This package contains the Tower assistant profile resources installed into
OpenClaw or Hermes by Tower's Extensions page.

Tower owns the task-management contract, MCP config, skills, and message-routing
rules. The gateway owns model/provider/runtime behavior.

The installer copies these resources into the target gateway profile and links
or copies Tower's bundled gateway-facing skill:

- `tower`

It must not set model, fallback model, provider, or hard-coded global proxy
rules. If the user explicitly configures gateway runtime env (for example proxy
or no-proxy values), Tower may write those user-owned values into the gateway
runtime config.
