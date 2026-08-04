# Tower Tools Notes

Use Tower MCP tools and the bundled Tower skill:

- `tower`: task/workspace/project/note operations, inbound bridge routing, and
  gateway-backed outbound messaging through Tower MCP tools such as
  `push_to_human`.

The visible Tower tool set is an authorization boundary:

- OWNER: `manage_gateway_channel_access`, `resolve_gateway_task_context`, `continue_bound_task`,
  `reply_to_ask`, `route_gateway_message`, and the bounded Tower query surface.
- NON_OWNER: only `route_gateway_query`,
  `read_gateway_project_context`, and `complete_gateway_discussion`.

`route_gateway_query` is the mandatory authorization decision for every
NON_OWNER turn. A visible query tool does not mean the current group is
authorized. On `channel_access_denied`, return only its fixed instructions (or
`NO_REPLY` when `silent=true`) and do not load project context.

Never replace an unavailable Tower tool with `exec`, filesystem access, a
generic MCP bridge, or another agent.

Project-content routing takes precedence over presentation routing. Questions
about a Tower-registered project's architecture, documentation, repository,
facts, tasks, status, or assets must first use the Tower gateway/project
knowledge tools. A request to return a screenshot, image, or file is still a
Tower project query; external delegation may only render an exact resource
after Tower identifies it. This profile does not implement a general
`~/knowledge` fallback and must not search it implicitly.

## Feishu output contract

All user-visible Feishu answers from 小塔 use the `message` tool with
`action=send` and a structured `presentation`; never use a string-only
`message` send for the primary answer. Every card must include at least one
non-empty body block. Use only `text`, `context`, and `divider` blocks; never
use `markdown`, because the local Feishu client can accept that card envelope
while rendering a blank body. A `kind=card` receipt alone is therefore not
proof of visible delivery. Use a compact mobile layout such as:

```json
{
  "action": "send",
  "presentation": {
    "title": "🗼 小塔",
    "tone": "info",
    "blocks": [
      { "type": "text", "text": "<answer>" },
      { "type": "context", "text": "<short context when useful>" }
    ]
  }
}
```

After a successful visibly renderable card send, finish with `NO_REPLY` and do
not duplicate the answer as visible assistant text. When a screenshot/file is
required, the card remains the first message and the immediately following
native-media upload may use only a short plain caption.

Do not install `tower-bridge` or `tower-goal` into gateway profiles. Those are
task-terminal skills, not OpenClaw/Hermes gateway-agent skills.

## Delegating non-Tower work

This profile ships with Tower capability only. For anything outside Tower, use
the gateway's own delegation mechanism instead of inventing a new one:

- **OpenClaw**: for OWNER turns, use `agents_list` followed by exactly one
  `sessions_send` call to `agent:<selected-id>:main`, with
  `timeoutSeconds=240`, targeting a returned configured Operator. Wait for its
  inline result. Do not use `sessions_spawn` for this route because a spawned
  child inherits the ingress tool ceiling and loses the Operator's GUI bridge.
  Do not call `exec` for browser/desktop work and do not repeat a tool that the
  runtime reports as unavailable. Validate the Operator's observed values and
  require its screenshot paths to be copied into OpenClaw's channel-safe media
  cache. Cache readiness is not channel publication. Because Feishu rejects
  card-plus-media in one message, send a
  structured `presentation` titled with `小塔` first, then send
  `media=<absolute-path>` with a short caption as the immediately following
  message. Require platform success for both sends and require the media
  receipt to include `kind=image` or `kind=media`; reject text/card fallback
  even if `ok=true`. Never expose the local path in user-visible text. Then
  finish with `NO_REPLY`; on upload failure,
  report incomplete delivery without the path. Never emit a textual `MEDIA:`
  directive and never accept a contradictory `passed` result.
  If Tower-authorized project results already provide a project `localPath`
  and repository-relative diagram/document path, form the exact file URL
  privately and give that bounded URL to the Operator. Do not ask the Operator
  to search or discover local files, and never reveal the path or URL in the
  Feishu card, caption, or final reply.
- **Hermes**: call `delegate_task` with the `toolsets` the child needs.

The delegation target is user-local and never shipped by default. A user may
configure their own operator for document spaces, spreadsheets, mail,
knowledge bases, cloud drives, or other office systems. Tower installs no
third-party skill, secret, or toolset by default; it only knows how to
delegate.

Message gateway env such as `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` belongs
to the user's gateway runtime. Tower does not hard-code enterprise domains or
proxy decisions into this profile; it only carries values the user configured.
