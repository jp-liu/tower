# Tower Loop Hub — Design (v2, todolist model)

> Status: Draft v2 — supersedes the earlier battle-map draft. Updated 2026-07-10.
> Core: forgetful hub + externalized todolist + command-line agent sessions + timed heartbeat.

---

## §3 Architecture (three layers)

```
① Backend timer (cron-like, MANDATORY)
   Every <interval>: inject an "advance" prompt into the hub session.
   Hub parked -> resume first, then inject. Reads child-task states to decide when to stop.
        | inject "advance" (reuse notify-parent write-to-PTY path)
        v
② Loop hub session  (= tower-loop skill = the hub prompt)
   Each wake: read todolist -> advance one item -> write back. Stateless; child tasks are the truth.
        | create_task (inherits TOWER_TASK_ID -> parentTaskId) + start execution (spawn CLI agent)
        v
③ Child task sessions (executors, own terminal / optional worktree)
   Solve one item -> end round -> stop hook -> notify-parent pushes a review prompt back to the hub
   (only while hub PTY is alive).
```

**Why the timer is mandatory:** `notify-parent` only fires while the hub PTY is alive (it skips a killed/absent parent). Unattended, the hub is parked most of the time, so event pushback alone loses signals. The timer's periodic wake + poll is the safety net.

| Mechanism | Fires when | Role |
|---|---|---|
| Derivation pushback (event) | Hub alive when a child ends | Accelerator |
| Backend timed wake (poll) | Hub parked; interval elapses | **Safety net (lifeline)** |

---

## §4 Core Data Structure: the todolist IS the hub's child tasks

The single most important decision. **Do not store the todolist separately** (no note, no file). Tower is already a task platform (Workspace→Project→Task, with `status` and `parentTaskId`). So:

> **Each todolist item = one child Task (`parentTaskId` = hub). The whole todolist = `list_child_tasks(hubTaskId)`.**

**Mapping**

| Todolist concept | Native Tower |
|---|---|
| A todo item | a child Task |
| Item state (todo/doing/done) | `Task.status` (TODO / IN_PROGRESS / IN_REVIEW / DONE) |
| "Spawn a task to solve it" | start an execution for that child Task (a CLI agent session) |
| "Check this item is done" | its status: child ends round -> IN_REVIEW; hub accepts -> DONE |
| Todolist order | `Task.order` (kanban ordering) |
| The whole todolist | `list_child_tasks(hubTaskId)` |

**Why native child tasks beat a note/file**
1. **Reconcile drift disappears.** A note is a shadow copy of real state and must be reconciled each round to avoid drift. Child tasks ARE the tasks — todolist and execution state are the same object, can never diverge. (Retires the "reconcile iron law" of the previous draft — it solved a problem this model doesn't have.)
2. **Management UI + intervention are free.** Child tasks already show on board/missions; user can add/edit/delete/reorder. Intervention = editing the todolist on the board (§9).
3. **Stop check trivial.** "All child tasks DONE?" = one query.
4. **Fits Tower's nature.** A todo item IS a task, not text pretending to be a list.

**Goal & planning narrative** (big-goal text, decomposition rationale, decision log) are low-frequency planning prose — put them in the **hub task's own description** (or one attached note). **Board noise:** tag the children with a `loop:<hub>` label for filtering/folding.
