---
name: tower-goal
description: Enter "unattended goal mode" mid-run — set a goal and let the current task run toward it on its own, submitting bounded OWNER messages when stuck so nothing is lost while you're away. Activate when the user says things like "/tower-goal", "start the loop", "go unattended", "I'm leaving, let it finish on its own", "set a goal and run autonomously", or "run it while I'm away".
---

# tower-goal — unattended goal mode (activated at run time)

A plain goal's flaw: it stalls the moment it gets stuck, and with nobody watching it just dies unnoticed. tower-goal fixes that gap — **run toward the goal on your own, and when you hit a wall push a message to the human via a channel**; if they're away, park and wait, and pick up when they reply.

This skill lets you **switch into the mode partway through a run** (e.g. the user says "finish this, I'm leaving"). Activation is the user's decision to run unattended and to use the configured OWNER channel. It is runtime state, not blanket authorization for external side effects.

Do not confuse this with a plain Claude/Codex/Tower "goal" or long-running task. A generic Goal UI/session means "keep working toward an objective"; it does **not** authorize outbound human messaging or parking. Only explicit activation of this `tower-goal` skill (or a persisted `set_goal_mode(taskId, true)` flag) enters unattended mode.

## Activation = bounded commitment

The user activating tower-goal authorizes autonomous scheduling inside the task's existing permissions:

- **You may create tasks**: if the goal is large, use Tower MCP (`create_task`) to split it into child tasks and dispatch them.
- **You are the hub**: when a child task finishes, its completion integration **pushes back to this parent task automatically** (you receive its result as a new message); after dispatch, end the current turn and wait for that callback — do not sleep or poll the child. You schedule / dispatch the next step from the callback. Child tasks don't worry about unattended themselves — **you're unattended, so the whole chain is unattended**: they just execute what you dispatch, push problems back to you, and you (the hub) decide whether to ask the human through the bounded OWNER capability.
- **You may use already-authorized Tower/project capabilities** in service of the goal (edit code, create tasks, query the knowledge base, orchestrate the hub).

Activation never creates a third-party grant and never upgrades R2/R3 actions. External write, delete, bulk, permission, publish, or otherwise risky actions require a valid bounded `authorizationRef`; without one, push the exact decision to the OWNER and park. Never infer that grant from the goal text or from `set_goal_mode` being active.

## Activation = commitment

On activation the user gives you a **goal** ("finish the login refactor"). Note it, then:

### 1. Self-check capability and grant FIRST (before flipping any flag)

tower-goal is the "off-hours, reach the owner" case. Call
`discover_gateway_capabilities({ taskId })` (`taskId` = env `TOWER_TASK_ID`) and
inspect `human.message.send`:

- `available: false` → ask the user to configure an unattended OWNER channel,
  and **do not** call `set_goal_mode`.
- `authorization.authorizationRef: null` → ask the user to click **Enable
  unattended** on this Tower task and choose the duration. The default is 8
  hours. Do not claim that the explicit chat instruction itself minted a grant.
- Available plus a non-null authorizationRef → retain that opaque ref for
  `submit_capability_request` and continue.

### 2. Persist the goal runtime (only once a channel exists)

Now call **`set_goal_mode(taskId, true)`**. It marks this task as goal mode and **persists it** — so even if your context is later compacted, or park/resume/a new session makes you "forget you're looping", `list_notify_targets` still resolves the default channel to `unattended` (reach the owner), and you won't misroute or fail to send when you hit a wall.

The flag is **auto-cleared** when the task leaves the active loop (you Stop the terminal, or the task moves to DONE/CANCELLED/IN_REVIEW), so you rarely close it by hand.
It is also auto-cleared at the selected deadline. The OWNER can disable it
early at any time. New tasks never inherit this flag and their creation or
startup is not gated by the parent task's Goal state.

### 3. Advance autonomously, silently

Work toward the goal; decide anything you can decide yourself. **Don't report progress proactively** — not even milestones; run quietly. Only speak up in the two moments below.

### 4. Speak up only when "stuck" or "done"

On these two cases, submit one `human.message.send` DIRECT request with a stable
UUID `requestId`, the discovered `authorizationRef`, and `expectReply: true`.
Set `inputs.goalTerminal` to `COMPLETED` for the final result or `BLOCKED` for a
real blocker. This structured marker lets Tower adopt the request as the Goal's
terminal notification and suppress the lifecycle safety-net duplicate.
The deterministic adapter sends to the fixed OWNER home route and atomically
records/parks the task. Stop after the result is `SUCCEEDED`; on
`SIDE_EFFECT_UNKNOWN`, stop and wait for manual reconciliation without retrying:

- **Truly stuck**: a decision that needs the human, missing key info, an ambiguous requirement, or **sign-off before a risky/irreversible action** (drop a DB, force-push, publish externally — required even if the terminal has permissions wide open).
- **Goal reached**: submit the result + wrap-up with `expectReply: true`, then park and stop.

Tower also persists a terminal-notification intent when an active Goal leaves
the loop. If the agent omitted the request, Tower uses the remaining bounded
OWNER grant to submit the same logical notification once. A completed Goal is
`ENDED` independently of delivery; an expired grant or delivery failure remains
visible and recoverable through `ownerNotificationState`. A genuine blocker
remains `BLOCKED`. `SIDE_EFFECT_UNKNOWN` remains terminal and is never retried
automatically.

### 5. Reply → continue; no reply → leave it

- Human replies → the platform bridge injects it via `reply_to_ask` as your next message → **continue per the reply**.
- If the blocker asked the OWNER to approve browser, Feishu, desktop, SaaS, or
  other Operator work that this terminal cannot perform, ask them to have
  OpenClaw execute the exact operation. The Gateway executes it after approval
  and injects the validated operation result through `reply_to_ask`. Continue
  from that result; never treat a bare "可以" as external authorization and do
  not submit the same operation again from Tower.
- No reply → it just stays parked, **harmless** (recorded in the `/harness` panel, unconsumed). The user will handle it themselves; don't poll, don't nag.

## Iron rules

- **OWNER outbound uses the CapabilityRequest path**: do not duplicate the same
  logical message through `push_to_human` or a platform MCP.
- **Sign-off through an authorized OWNER capability request before any risky/irreversible action**, no exceptions.
- **Goal mode is not external authorization**: no valid bounded grant can authorize a new external action, even when the overall goal was approved. A failed final notification changes only `ownerNotificationState`, not an already completed Goal's state.
- **End your turn immediately after a successful request with `expectReply: true`** — don't keep working; it parks the task and closes the terminal to save resources, and resumes automatically when the human replies.
- **Don't change task status or close the terminal on your own** — even "done" just parks and stops; let the user review/close it.
- taskId comes from env `TOWER_TASK_ID`.

## One line

> Run silently toward the goal; when stuck or done, submit one authorized OWNER message and park; reply → continue, no reply → leave it.
