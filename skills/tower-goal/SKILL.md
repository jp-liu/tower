---
name: tower-goal
description: Enter "unattended goal mode" mid-run — set a goal and let the current task run toward it on its own, pushing blockers/decisions to the human (via tower-ask) when stuck so nothing is lost while you're away. Activate when the user says things like "/tower-goal", "start the loop", "go unattended", "I'm leaving, let it finish on its own", "set a goal and run autonomously", or "run it while I'm away".
---

# tower-goal — unattended goal mode (activated at run time)

A plain goal's flaw: it stalls the moment it gets stuck, and with nobody watching it just dies unnoticed. tower-goal fixes that gap — **run toward the goal on your own, and when you hit a wall push a message to the human via a channel**; if they're away, park and wait, and pick up when they reply.

This skill lets you **switch into the mode partway through a run** (e.g. the user says "finish this, I'm leaving"). Unattended isn't a property of the task or something the backend decides — **the user activating this skill IS the judgment and the authorization.**

## Activation = authorization

The user activating tower-goal = authorizing you to **do whatever the goal needs**, in this task, without asking step by step:

- **You may create tasks**: if the goal is large, use Tower MCP (`create_task`) to split it into child tasks and dispatch them.
- **You are the hub**: when a child task finishes, its stop hook **pushes back to this parent task automatically** (you receive its result as a new message); you schedule / dispatch the next step from that. Child tasks don't worry about unattended themselves — **you're unattended, so the whole chain is unattended**: they just execute what you dispatch, push problems back to you, and you (the hub) decide whether to ask the human via tower-ask.
- **You may use any capability** in service of the goal (edit code, create tasks, query the knowledge base, orchestrate the hub…).

The only hard boundary is under "Iron rules" below — risky/irreversible actions still need sign-off first.

## Activation = commitment

On activation the user gives you a **goal** ("finish the login refactor"). Note it, then:

### 1. Self-check the channel FIRST (before flipping any flag)

tower-goal is the "off-hours, reach the owner" case, so it uses the **`unattended`** channel class. Call `list_notify_targets({ scope: "unattended", taskId })` (`taskId` = env `TOWER_TASK_ID`) to confirm an active channel exists:

- Present → note the `gateway`/`downstream`, continue to step 2.
- `noChannelConfigured: true` → tell the user "before running unattended, please configure a channel under Settings → Notifications → unattended column and mark it active, otherwise I can't push out when I hit a wall", and **do NOT enter the mode** (do not call `set_goal_mode`).

### 2. Set the goal-mode flag (only once a channel exists)

Now call **`set_goal_mode(taskId, true)`**. It marks this task as goal mode and **persists it** — so even if your context is later compacted, or park/resume/a new session makes you "forget you're looping", `list_notify_targets` still resolves the default channel to `unattended` (reach the owner), and you won't misroute or fail to send when you hit a wall.

The flag is **auto-cleared** when the task leaves the active loop (you Stop the terminal, or the task moves to DONE/CANCELLED/IN_REVIEW), so you rarely close it by hand.

### 3. Advance autonomously, silently

Work toward the goal; decide anything you can decide yourself. **Don't report progress proactively** — not even milestones; run quietly. Only speak up in the two moments below.

### 4. Speak up only when "stuck" or "done"

On these two cases, use the **tower-ask** skill (`scope: "unattended"`) to push a message to the owner, then call `ask_human(taskId, ...)` to **park** (stop; terminal stays open; task status untouched):

- **Truly stuck**: a decision that needs the human, missing key info, an ambiguous requirement, or **sign-off before a risky/irreversible action** (drop a DB, force-push, publish externally — required even if the terminal has permissions wide open).
- **Goal reached**: push the result + wrap-up to the human, then likewise `ask_human` park and stop.

### 5. Reply → continue; no reply → leave it

- Human replies → the platform bridge injects it via `reply_to_ask` as your next message → **continue per the reply**.
- No reply → it just stays parked, **harmless** (recorded in the `/harness` panel, unconsumed). The user will handle it themselves; don't poll, don't nag.

## Iron rules

- **All outbound goes through tower-ask**: every "send a message to a human" in goal mode follows tower-ask's rules (platform MCP send + the `[[tower:task=<taskId>]]` token → then `ask_human`/`notify_human`).
- **Sign-off via `ask_human` before any risky/irreversible action**, no exceptions.
- **End your turn immediately after calling `ask_human`** — don't keep working; it parks the task and closes the terminal to save resources, and resumes automatically when the human replies.
- **Don't change task status or close the terminal on your own** — even "done" just parks and stops; let the user review/close it.
- taskId comes from env `TOWER_TASK_ID`.

## One line

> Run silently toward the goal; when stuck or done, push to the human via tower-ask + `ask_human` park; reply → continue, no reply → leave it.
