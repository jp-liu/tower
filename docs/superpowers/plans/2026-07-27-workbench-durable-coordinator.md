# Workbench Durable Event Coordinator

## Scope

This phase replaces direct child-to-parent PTY callbacks with a lightweight,
SQLite-backed coordinator inside the existing Tower process. `Task`,
`Task.parentTaskId`, `TaskExecution`, and `TaskMessage` remain the work and
conversation records. No WorkItem, TaskGroup, queue service, or session model is
introduced.

## Existing Flow Audit

- Claude's `scripts/tower-stop-hook.js` posts `taskId`, `sessionId`, and the last
  assistant reply to `/api/internal/hooks/stop` after every completed turn.
- The stop route broadcasts a transient browser notification. An open harness
  ask parks the child by destroying its PTY. Otherwise
  `notifyParentOnChildStop` writes a full review prompt directly to the live
  parent PTY and drops the callback when the parent has no in-memory session.
- Direct PTY delivery is process-local, best effort, and split into a body write
  plus a delayed carriage return. Concurrent child stops therefore race through
  one TUI input box; restarts lose the in-memory work and duplicate hook calls
  have no durable idempotency boundary.
- `TaskExecution` is finalized independently by the fresh, resume, and continue
  `onExit` callbacks. A zero exit moves the task to `IN_REVIEW`; a non-zero exit
  remains `FAILED`. These paths broadcast UI completion events but do not
  reliably notify a parent.
- PTY idle is a one-shot, output-based timer and is not a semantic prompt-ready
  signal. Harness reply relay has its own durable `HarnessMessage` ask lifecycle
  and restart/injection retries, but it targets human replies rather than child
  completion review.

## Durable Model

`WorkbenchEvent` is an inbox row owned by `parentTaskId` and sourced by a child
task and optional execution. It stores:

- a caller-supplied stable `dedupKey` with a unique index;
- an optional unique `executionReviewKey` that arbitrates the first review
  between a provider stop hook and the provider-neutral successful-exit fallback;
- event kind and priority;
- a JSON payload snapshot suitable for review after the child terminal exits;
- `PENDING -> PROCESSING -> CONSUMED` state, claim token/time, attempts,
  consumption time, and last error.

Duplicate producers use an insert-or-return-existing `dedupKey` contract.
Consumers atomically claim pending rows for one parent. Failed delivery returns
the claim to `PENDING`; abandoned processing leases are recoverable. Before
delivery, the drain upserts one deterministic `TaskMessage(SYSTEM)` for the
batch. Successful PTY delivery then advances only that claim to `CONSUMED`;
retries reuse the same message and batch key.

## Processing Boundaries

```text
child stop / failed exit
        |
        v
  durable enqueue ---- duplicate dedupKey ---> existing row
        |
        v
parent stop hook (completed turn, TUI prompt boundary)
        |
        +-- short coalescing window --> claim all pending parent events
                                      --> one review batch
                                      --> TaskMessage + PTY write
                                      --> CONSUMED
```

Child callbacks never write to the parent directly. The parent's own stop hook
is the provider-independent safe boundary: it means the current agent turn has
ended. A small coalescing window gathers sibling completions that arrive
together. High-priority decision and failure events use a shorter window, but
still wait for that boundary instead of relying on mid-turn PTY behavior.

If the parent is not running, pending rows remain in SQLite. Starting or
resuming the parent does not inject into a booting TUI; its next stop hook opens
the natural drain boundary. Server startup first recovers expired claims, then
reconciles finalized child executions that have no corresponding review or
failure event. This closes the crash window between updating `TaskExecution`
and inserting the inbox row without coupling PTY finalization to a larger
transaction.

## Final Consistency Recovery

`TaskExecution.status` and `endedAt` are the durable completion facts. The
`0016-workbench-events-checkpoint` migration records
`workbench.eventsEnabledAt`, using the original `0014-workbench-events`
migration timestamp. Recovery only scans parent-owned `COMPLETED` and `FAILED`
executions at or after that lower bound, so upgrading an existing database does
not replay historical work.

For each missing execution, recovery calls the same
`enqueueChildExecutionResult` producer used by PTY exit. Existing stop-hook and
completion fallback reviews satisfy a successful execution; an existing
failure event satisfies a failed execution. The unique execution review guard
and stable execution dedup keys make repeated startup passes safe. A missing or
invalid checkpoint fails closed by skipping the scan and logging a warning.
Each pass is bounded to 500 executions; subsequent starts can repeat it.

PTY exit dispatch catches and logs transient enqueue failures, so an async
`onExit` callback cannot leak a rejected promise. The execution remains in its
terminal state and is repaired by the next startup reconciliation.

## Compatibility And Semantics

- A one-event review batch uses the existing child review prompt verbatim, so
  the hub still inspects the child and decides whether to stop/move it to DONE,
  request more work, or answer a blocker.
- Enqueuing an event never marks a child DONE. Existing execution finalization,
  callback URL environment, browser notifications, and harness ask/reply
  behavior remain intact.
- `CHILD_DECISION_REQUIRED` and `CHILD_EXECUTION_FAILED` are high priority and
  rendered before ordinary `CHILD_REVIEW_REQUIRED` items.
- Every final execution path calls `enqueueChildExecutionResult`. Failures always
  create a high-priority event. Successful exits create a normal review fallback
  only when no stop-hook review/decision owns that execution's review guard.

## Reusable Interface

- `enqueueWorkbenchEvent(input)` is the producer boundary for later Session and
  gateway stages. The producer owns the stable `dedupKey`; retries return the
  existing row.
- `enqueueChildExecutionResult(input)` is the provider-neutral terminal fallback.
  Stop and completion producers compete on `executionReviewKey`, while distinct
  later stop turns keep their per-turn `dedupKey` behavior.
- `openWorkbenchDrainBoundary(parentTaskId)` schedules a drain only after the
  parent's completed-turn signal.
- `drainWorkbenchEvents(parentTaskId, deliver)` claims, aggregates, delivers,
  and commits one retry-safe batch. Future gateways can replace the PTY
  `deliver` callback without changing persistence or aggregation.
- `recoverWorkbenchEventClaims()` releases expired processing leases during
  startup or an operator-triggered recovery pass.
- `recoverMissingWorkbenchExecutionEvents()` reconciles post-checkpoint terminal
  executions with the inbox. It is bounded, repeatable, and returns scan,
  recovery, and failure counts for startup instrumentation or future gateway
  health reporting.
