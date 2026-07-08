# MCP Hard-Rule Downshift & Skill Slimming

**Status:** implemented (branch `task/cmrc45vtq0001cmw5afp2j20n`)
**Scope:** Tower MCP handlers + `skills/tower/*`
**Audience:** codex review

## Problem

Tower's task-creation "protocol" (the `## 来源` provenance section, the
`<task-source>` bridge block, the parked-task reply path) lived entirely in the
`tower` skill prompt. Any AI client that ran at low reasoning effort — or simply
didn't load the skill — produced malformed tasks: missing `## 来源`, raw
`<task-source>` blocks stored verbatim, human replies injected into a parked
terminal instead of answering the open `ask_human`.

A prompt is advisory; a handler is enforced. This change moves the rules that
**must** hold for protocol correctness from the skill into the MCP handlers, and
slims the skill so its remaining (display-preference) rules are actually read.

## Source classification model

A task is created through exactly one of four channels. Only two carry external
provenance worth structuring:

| # | Channel | Signal | Provenance | Handling |
|---|---------|--------|-----------|----------|
| ① | Assistant panel | no parent, no block | none — created in place | `## 来源\n无` |
| ② | Normal task terminal | no parent, no block | none — created in place | `## 来源\n无` |
| ③ | Parent-derived | `TOWER_TASK_ID` set | structured (parent id + title) | server-rendered `## 来源` + `parentTaskId` |
| ④ | Bridge platform | `<task-source>` block | structured (channel, chat, transcript…) | server-parsed + server-rendered `## 来源` |

①② are "created in place, no external source" — they get a lightweight marker
(`无`), nothing more. ③④ are the only cases that need real, traceable rendering,
and both are now produced deterministically server-side.

## Hard vs soft rules

The dividing line: **a hard rule is one whose violation breaks protocol
correctness or data integrity** (something a downstream consumer relies on). A
soft rule is a display/wording preference — wrong output is ugly, not broken.
Hard rules move to the server; soft rules stay in the skill.

| Rule | Class | Home | Why |
|------|-------|------|-----|
| `## 来源` always present | hard | handler | provenance is data other tools/humans read; can't depend on model |
| `<task-source>` never stored raw | hard | handler | raw block leaks machine tags into human-facing description |
| Parent-derived task records its parent | hard | handler | mirrors the structural `parentTaskId` link used for completion callbacks |
| `channel` → prefix rendering | hard | handler | consistent, platform-generic provenance regardless of client |
| Parked task → `reply_to_ask` | hard | handler | raw send bypasses the ask lifecycle (never answers, never resumes) |
| Description Markdown template (`## 目标/需求/…`) | soft | skill | shape/wording preference; no consumer parses it |
| Display templates (tables, emoji markers) | soft | skill | pure presentation |
| Daily summary / todo formatting | soft | skill | pure presentation |
| Role/summary inference from transcript | soft | skill | needs a model; provenance is still valid without it |

## Server landing points

Each hard rule and where it now lives:

### 1. `## 来源` guarantee — `src/mcp/tools/task-source.ts` → `resolveTaskSource()`

Called by `create_task` before persisting. Precedence:

1. `<task-source>` block present → strip it; render a channel-generic `## 来源`
   (unless the model already wrote its own `## 来源`, which is preserved).
2. Parent-derived and no `## 来源` yet → append parent-derivation source.
3. Described but no `## 来源` → append `## 来源\n无`.
4. No description and no parent → leave `undefined` (nothing to source).

It **never rejects and never asks the user to retry** — a silent, additive
fix (per the explicit product decision against return-for-rework).

### 2. `<task-source>` structural stripping — same module → `parseTaskSourceBlock()` + `renderBridgeSource()`

A tiny line-based parser (flat `key: value`, a `participants:` list, a
`transcript: |` block scalar — no YAML dependency) extracts the fields; the
renderer emits only the deterministic ones. The raw block is removed from the
stored description in all paths.

### 3. Parent-derivation source — `create_task` handler (`task-tools.ts`)

The handler already bound `parentTaskId` from `TOWER_TASK_ID`; it now also passes
the resolved `{ id, title }` into `resolveTaskSource` so the human-readable mirror
is written even when the model omits it.

### 4. `channel` → prefix mapping — `task-source.ts` → `channelLabel()`

A `CHANNEL_PREFIX` map (`feishu`→飞书群, `wechat`→微信群, `wecom`→企业微信群,
`lark`, `openclaw`, `manual`), case-insensitive, with raw-value fallback so an
unknown channel still renders acceptably.

### 5. Parked-task send guardrail — `send_task_terminal_input` (`terminal-tools.ts`)

Before forwarding to the terminal bridge, the handler checks `getOpenAsk(taskId)`.
If the task is parked on an `ask_human`, it returns `{ redirected: true, reason:
"pending_ask", requestId, question, message }` and does **not** send — steering
the caller to `reply_to_ask`, which marks the ask answered and resumes the task.

## `task-source` bridge protocol (generalized)

`<task-source>` was never Feishu-specific; `channel` is an enum. The
generalization:

- **Channel enum + render map** (table above) — Tower renders any channel; adding
  one is a one-line map entry.
- **`channel` = the real platform** (WeChat/Feishu) where the discussion
  happened. The **transport bot** (hermes/openclaw) that carried the message goes
  in an optional secondary `bridge` field, rendered as a `传输` line, never as the
  main channel. Swapping the bot leaves provenance meaning unchanged.
- **Rendered shape** (only present fields emitted):

  ```
  ## 来源

  - 渠道：飞书群「{chat_name}」
  - 传输：{bridge}
  - 时间：{occurred_at}
  - 参与者：{name1、name2、…}
  - 讨论要点：{summary}
  - 打开群：{chat_link}
  - 溯源 ID：chat={chat_id} · msg={trigger_message_id}[ · thread={thread_root_id}]

  讨论摘录（按时间）：
  {transcript}
  ```

## Skill structure after slimming

`skills/tower/SKILL.md`: 444 → ~180 lines.

- **`Core Contracts (必守)`** — 11 hard rules at the top (act-don't-announce,
  operator-scope, structured description, don't-hand-format-source, worktree
  defaults, render-from-response, references, replace-not-merge, display
  templates, parked→reply_to_ask, unattended contract).
- **Scenarios** — compressed to point at the contracts, not restate them.
- **`references/`** (directory-copied into the runtime skill dir by
  `ensureTowerDir`):
  - `display-templates.md` — all mandatory output formats (moved out of main).
  - `task-source.md` — rewritten around server-side rendering; documents the
    block format, channel map, and `bridge` vs `channel`.
  - `unattended-messaging.md` — unchanged.

The `display.ts` single-source-of-truth for server-rendered cards named in the
task brief **does not exist yet** in the codebase; server responses are still
rendered by the model via the skill templates. Introducing it is left as a
separate refactor (see boundaries) — this change keeps the templates as the
single source in `references/display-templates.md`.

## Skill copy caveat

`skills/tower/` is the single source. `ensureTowerDir` directory-copies it into
the Tower-owned runtime config dir; the copy refreshes when the bundled SKILL.md
changes. **Editing a skill requires a service restart** to refresh the runtime
copy. The two on-disk copies are not a divergence bug — the runtime one is
gitignored and regenerated.

## Explicitly NOT done (out of scope / can't be enforced server-side)

**Deliberately not built** (would break callers or force user rework):

- **No structured `goal`/`requirements`/`source` columns.** `description` stays a
  single Markdown blob. Splitting it would rewrite every caller, the skill, and
  the Feishu renderer for little gain.
- **No reject-and-retry on malformed input.** Validation is always additive; the
  handler fixes silently. (Product decision: rework was explicitly vetoed.)
- **No `display.ts` extraction** this pass (see above).

**Physically un-enforceable server-side** — left to the model/bridge, documented
so reviewers don't expect a server guarantee:

- **References-file completeness.** The server never sees the user's original
  message, so it can't know a file was mentioned but not passed in `references`.
- **"Stop after `ask_human`."** Whether the model actually ends its turn is model
  output behavior; the tool return can only *advise* (its message says "stop
  now"), not force it.
- **Outbound `[[tower:task=<id>]]` correlation token.** Outbound messages are sent
  by the platform's own MCP (Feishu/WeChat), never through Tower, so Tower cannot
  stamp them.
- **Correct `channel`/`bridge` injection.** Each bridge bot (in its own repo,
  e.g. `~/assistant`) must emit the right values. Tower only guarantees
  parse/render for **any** channel.
- **Role/summary inference.** Needs a model; the server renders raw fields only.

## Tests

`pnpm test:run` — MCP + harness suites go 101 → 122 (+21), all green. New /
changed coverage:

- `task-source.test.ts` (new): channel map, block parser, bridge render, and
  `resolveTaskSource` precedence (fallback `无`, parent source, block stripping,
  model-source preservation).
- `task-tools.test.ts`: the old "handler never writes 来源" assertion is flipped;
  added handler-level tests for parent source, silent `无` append, block
  stripping.
- `terminal-tools.test.ts`: `getOpenAsk` mocked; new test asserts the parked-task
  send redirects to `reply_to_ask` without touching the terminal bridge.

**Green tests ≠ skill un-regressed.** Whether a real model *obeys* the slimmed
skill is not unit-testable; it needs live smoke tests: create_task writing a
source, Feishu/WeChat `<task-source>` ingestion, unattended `ask_human` stop
behavior, and `reply_to_ask` on a parked task.
