# Tower Platform Hardening Follow-up Plan

> Status: Final; approved after two code-grounded review rounds
> Date: 2026-07-31
> Scope: CI repair, extension worktree integration, operational-data lifecycle,
> and MCP surface control

## 1. Decision Summary

This round implements four bounded improvements:

1. repair the GitHub Actions workflow so CI jobs can start;
2. rebase and integrate the existing Extensions Platform worktree;
3. add measurement and bounded compaction for settled Workbench/Gateway
   operational duplicates without weakening replay;
4. reduce the MCP tool surface exposed to each runtime role and restore one
   source of truth for the tool catalog.

This round explicitly does **not**:

- split Tower, Gateway, Workbench, or MCP into separate npm packages;
- publish a new public or internal npm release;
- move Gateway to another process or database;
- add a generic Event Bus, dynamic subscriber runtime, broker, or workflow DSL;
- introduce a second idempotency ledger merely to permit aggressive deletion;
- continue the Workbench/Gateway architecture refactor beyond the boundaries
  already merged in PR #26.

Each improvement is delivered as an independent PR. A later PR must not be
required to make an earlier PR correct.

## 2. Verified Baseline

### 2.1 CI

The current `main` workflow fails before creating any job. The invalid expression
is the job-level environment value:

```yaml
jobs:
  catalog:
    env:
      CATALOG_OUTPUT_DIR: "${{ runner.temp }}/tower-extension-catalog"
```

`runner` is unavailable while `jobs.<job_id>.env` is evaluated. The same
expression is valid inside a step. This is a workflow-startup defect, not a test
failure.

### 2.2 Extensions worktree

The clean worktree at `/Users/liujunping/project/f/tower-extensions-platform-v1`
contains four commits on `codex/extensions-platform-v1`:

```text
67a31d8 feat(settings): establish extension platform foundation
9aae81e feat(settings): expose unified extension inventory
c6d8847 feat(settings): add extension manifest sdk
ed94325 fix(settings): harden extension platform contracts
```

It is based on `27c6248` (`v0.3.0`) rather than current `main`. It adds the
Manifest SDK, normalized inventory, legacy/CLI inventory adapters, tests, and
architecture/specification documents. It does not yet provide a general
extension runtime or arbitrary extension-owned persistence. The new
`@tower-org/extension-sdk` remains private in this phase.

### 2.3 Workbench and Gateway

PR #26 completed the agreed first boundary phase:

- PTY publishes generic lifecycle facts and does not import Workbench;
- Gateway publishes through `workbench/command-inbox` rather than importing the
  coordinator;
- the Workbench coordinator no longer writes Gateway tables;
- Gateway owns the adapter that projects Workbench delivery into
  `GatewayInbound` state;
- module-boundary tests guard these dependency directions.

The reliable protocol remains at-least-once terminal injection with idempotent
persistent effects. This plan does not redesign that protocol.

### 2.4 MCP

The runtime catalog currently exposes 57 tools: 36 Assistant tools and 21
Harness/Gateway tools. The bundled MCP server is approximately 4.1 MB, while
tool descriptions alone contain approximately 19,000 characters before JSON
schemas. `harness-tools.ts` is over 1,000 lines. Documentation counts are stale
and disagree with the runtime catalog.

The binary size is not the primary concern. The concerns are model context,
tool discovery, authorization surface, and ownership of a growing adapter file.

## 3. PR 1 - Repair CI Startup

### Goal

Restore real CI execution before rebasing or reviewing the larger extension
branch.

### Changes

1. Remove `CATALOG_OUTPUT_DIR` from `jobs.catalog.env`.
2. Use `${{ runner.temp }}/tower-extension-catalog` directly in the three steps
   that generate, validate, and upload the catalog, or place it in step-level
   `env` for those steps.
3. Fetch release history in the test job because the existing migration matrix
   reads the tagged `v0.2.60` Prisma schema with `git show`.
4. Make the existing CLI plugin provider fixture declare its known path for the
   current test platform rather than hard-coding macOS, so the same assertion is
   valid on the Linux runner.
5. Keep the public package registry, Node/pnpm versions, test database, and
   artifact behavior unchanged.
6. Update no production business code in this PR.

### Acceptance

- GitHub displays the workflow as `CI`, not `.github/workflows/ci.yml`.
- The `test` and `extension catalog` jobs are both created.
- Both jobs complete successfully on a pull request to `main`.
- The migration matrix can read the historical release schema, and the CLI
  plugin resolver test passes on the Linux runner.
- A failure has a job log; zero-job workflow-startup failures are gone.

## 4. PR 2 - Integrate Extensions Platform V1 Foundation

### Goal

Bring the existing reviewed worktree onto current `main` without expanding its
scope into publishing or an arbitrary plugin runtime.

### Integration procedure

1. Complete and merge PR 1 first.
2. Fetch current `main` in the extensions worktree and rebase
   `codex/extensions-platform-v1` onto it.
3. Resolve `.github/workflows/ci.yml`, `package.json`, `pnpm-lock.yaml`, and any
   extension inventory conflicts in favor of the post-PR-1 CI contract and the
   current `0.3.1` application tree.
4. Preserve the four logical commits unless conflict resolution makes a small
   fixup commit clearer than rewriting reviewed history.
5. Review the diff against current `main`, not against the old `v0.3.0` base.

### Scope guardrails

- Keep `@tower-org/extension-sdk` private.
- Keep official extensions in the monorepo.
- Keep kind handlers host-owned.
- Do not give third-party packages arbitrary Prisma, filesystem, process, or
  network access.
- Do not add extension-owned databases or a generic storage API in this PR.
- Do not publish Catalog v2 or migrate Gateway runtime state into an extension.

### Verification

- Extension SDK build, typecheck, and manifest tests.
- Inventory, legacy inventory, and CLI inventory tests.
- Full TypeScript and lint checks.
- Full Vitest suite.
- CI extension catalog generation and runtime validation.
- Existing Gateway/Workbench boundary tests remain green.
- Architecture, requirements, specification, and implementation plan agree on
  what V1 implements and what remains deferred.

## 5. PR 3 - Operational Data Observation and Bounded Compaction

### 5.1 Correct interpretation of "consumed" and revised scope

`WorkbenchEvent.CONSUMED` is not disposable telemetry. It is written in the
same transaction that resolves its `WorkbenchBatch`, but existing recovery uses
the durable event identity to prevent or repair duplicate reviews. Gateway
recovery can also requeue a previously consumed Gateway-related event when a
linked task remains unfinished.

Immediate hard deletion at `resolveWorkbenchBatch` would break at least these
contracts:

1. repeated `resolve_workbench_batch` calls would stop being idempotent and
   return `Unknown Workbench batch`;
2. startup reconciliation could recreate an already handled execution review
   after its unique `executionReviewKey` row disappears;
3. Gateway recovery could no longer requeue a consumed request/review after a
   process exit;
4. deleting Gateway inbound rows would remove the existing deduplication and
   task-link ledger, allowing a delayed platform retry to create work again;
5. deleting delivered responses immediately would remove the cached result used
   to answer duplicate callbacks consistently.

Therefore this phase separates **replay input**, **duplicate operational
copies**, and **small idempotency identity**. It does not delete ledger rows
merely because the consumer acknowledged them.

The first review found an additional constraint: `WorkbenchEvent.payload` is
still replay input after a consumed event is requeued. Current task status is
not monotonic: general task actions and MCP `move_task` can move a `DONE` task
back to `IN_REVIEW`, `IN_PROGRESS`, or another nonterminal state. Consequently,
no predicate based on a task being terminal at one point in time can prove that
an event payload will never be needed again.

This PR therefore makes the following conservative decisions:

1. **Do not compact or delete `WorkbenchEvent.payload` in V1**, including for
   `CONSUMED` events. Preserve the event as both replay input and an idempotency
   ledger.
2. Do not make terminal task status monotonic merely to enable cleanup. Reopening
   a task is existing product behavior, and changing it is outside this PR.
3. Do not make Workbench maintenance understand or join Gateway-owned tables.
   Some Gateway source identity is embedded in generic event JSON rather than a
   direct relation, and such a join would reverse the boundary established by
   PR #26.
4. Limit Workbench mutation to a field shown not to participate in resolved
   batch replay: the duplicate `WorkbenchBatch.prompt` on old `RESOLVED` rows.
5. Keep Gateway compaction entirely Gateway-owned and independently guarded by
   Gateway state and delivery relations.

The goal is not presented as proven database pressure. No production row-count
or byte-growth evidence has been collected yet. The immediate value is to
measure growth and reduce selected duplicate operational message bodies. This
does **not** claim comprehensive sensitive-data erasure: the same user-visible
content can remain in `TaskMessage`, terminal logs, application logs, or
backups according to their own retention policies.

### 5.2 Scheduling decision

Do not add another `setInterval` or a new scheduler subsystem.

Extend the existing operational maintenance sweep in
`src/instrumentation-node.ts`. The existing process already runs the Harness
expiration sweep periodically. The composition root will invoke independent
Workbench and Gateway maintenance functions from that same bounded sweep.

The cleanup functions must be safe to call on startup and repeatedly. Run them
from the existing six-hour sweep without adding a new timer or persisted
`SystemConfig` scheduling state. Correctness must not depend on wall-clock
midnight or the process being alive at a particular time.

Use elapsed age, not calendar-day boundaries. A row completed at 23:59 must not
be destroyed at 00:01.

### 5.3 Measure before mutation

Before changing a row, maintenance calculates and returns at least:

- row counts grouped by relevant state;
- eligible row counts for each compaction rule;
- total stored text bytes and eligible text bytes for the fields in scope;
- compacted, skipped-active/raced, and failed counts.

Use SQLite `length(CAST(field AS BLOB))` or an equivalent byte-counting query;
JavaScript string length is not a byte measurement. Logs and returned metrics
contain counts and byte totals, never message bodies. The PR description records
a before/after sample from a real local database with secrets removed. If the
eligible payload is negligible, keep the observation code and omit the
corresponding mutation rather than adding cleanup complexity without benefit.

### 5.4 State policy

| Owner | State | Policy |
|---|---|---|
| WorkbenchEvent | any state | Keep the row and full payload. Never compact or delete in V1 because a consumed event can become replayable again. |
| WorkbenchBatch | `CLAIMED`, `DISPATCHED`, `ACKED` | Keep full prompt, event IDs, lease, and errors. |
| WorkbenchBatch | `FAILED` | Keep for recovery and diagnosis. Do not auto-delete in V1. |
| WorkbenchBatch | `RESOLVED` older than 24h | Replace the duplicate prompt with a fixed non-sensitive compaction marker. Retain the row, event IDs, generation, and timestamps as the idempotent resolution tombstone. The update itself must require `state = RESOLVED` and an old `resolvedAt`. |
| GatewayInbound | `RECEIVED`, `QUEUED`, `PROCESSING`, `FAILED` | Keep full content, response, errors, and task link. |
| GatewayDelivery | `PENDING`, `SENDING`, `FAILED`, `SENT_UNVERIFIED` | Keep full content and retry evidence. |
| GatewayInbound | `PROCESSED` older than 7d | Retain dedup, routing identity, state, timestamps, and task link. Compact `content`, `response`, and `lastError` only when no related delivery is nonterminal. The update must include that relation predicate. |
| GatewayDelivery | `DELIVERED` older than 7d with linked inbound `PROCESSED` | Retain dedup, platform delivery identity, state, attempts, and timestamps. Compact `content`, `presentation`, and `lastError`; the same database update must require `DELIVERED`, an old `deliveredAt`, and a linked `GatewayInbound` that is still `PROCESSED`. Deliveries with no inbound or a `RECEIVED`, `QUEUED`, `PROCESSING`, or `FAILED` inbound are skipped. |
| GatewaySession | `ACTIVE` | Keep. Current routing uses a seven-day recent-session window. |
| GatewaySession | `CLOSED` | Keep while any nonterminal inbound/delivery exists; otherwise it is eligible for later bounded pruning, which is not required in V1. |
| GatewayTaskLink | any | Keep while the linked Task and GatewayInbound exist. It is the task-creation idempotency ledger. |

The initial Gateway compaction age should be seven days because the current
router already defines a seven-day recent-session window. Shortening it to 24
hours is a separate behavior change and requires explicit product approval and
delayed-retry tests.

Hard deletion remains off in this PR. The bounded reduction comes from removing
the resolved batch prompt and old Gateway content, response, presentation, and
error bodies while retaining small indexed tombstones. The implementation uses
stable compaction markers so required string columns remain valid and repeated
maintenance is idempotent. SQLite may reuse freed pages; this PR does not run
automatic `VACUUM` in the application hot path and does not promise that the
database file immediately shrinks.

### 5.5 Ownership

- `src/lib/workbench/maintenance.ts` owns Workbench compaction queries.
- `src/lib/harness/gateway-maintenance.ts` owns Gateway compaction queries.
- `src/instrumentation-node.ts` only composes and schedules them.
- MCP handlers and route handlers do not contain cleanup SQL.
- Workbench maintenance must not import Gateway modules or query
  `GatewayInbound`, `GatewayDelivery`, or `GatewayTaskLink`.
- Gateway maintenance must not mutate Workbench rows.
- Do not create a storage interface until a second real storage implementation
  exists.

### 5.6 Safety and observability

Each maintenance function returns counts for scanned, compacted, skipped-active,
and failed rows. Logs contain IDs/counts only, never message bodies.

All updates use state, age, and relation predicates in the database write, not
only in a preceding read. A row that changes back to an active/retryable state
between measurement/selection and update must be skipped. This atomicity is
local to each owning module; it must not be implemented with a cross-module
Workbench-to-Gateway join.

Maintenance failure is best-effort and must not terminate Tower. It must not
hold a transaction while calling a gateway, PTY, filesystem, or network API.

### 5.7 Tests

- no `WorkbenchEvent` row or payload is changed in any state;
- no active or failed Workbench batch is compacted;
- a resolved batch younger than 24 hours is unchanged;
- a resolved batch older than 24 hours has only its prompt replaced;
- repeated maintenance is idempotent;
- compacted resolution rows still make repeated ACK/resolve calls no-ops;
- execution reconciliation does not recreate a compacted handled review;
- reopening a source task after maintenance leaves its event payload available
  for replay;
- queued/processing/failed Gateway rows remain recoverable;
- `SENT_UNVERIFIED` is never treated as safely delivered;
- a processed inbound with a nonterminal delivery is not compacted;
- an old `DELIVERED` delivery whose inbound is `QUEUED` or `PROCESSING` is not
  compacted, while the same delivery becomes eligible after its inbound is
  `PROCESSED`;
- a Gateway row that changes from terminal to nonterminal between candidate
  measurement and the guarded update is skipped;
- duplicate Gateway input inside the retention window returns the same result;
- measurement reports row counts and text bytes without returning or logging
  message bodies;
- maintenance never logs message content;
- task/project/workspace cascade deletion remains valid after compaction.

### 5.8 Documentation

Update the Chinese and English Harness, Workbench/Gateway, operations, and data
model documentation with:

- the difference between replay payloads, duplicate operational copies, and
  idempotency tombstones;
- the 24-hour resolved-batch prompt and seven-day Gateway defaults;
- states that are never automatically compacted;
- the fact that all `WorkbenchEvent.payload` values remain intact in V1;
- the fact that compaction reduces selected duplicate copies rather than
  guaranteeing deletion from task messages, terminal logs, logs, or backups;
- the fact that backups may retain pre-compaction data according to backup
  retention policy.

No new architecture diagram is required because module ownership and data flow
do not change. Existing diagrams should only be edited if a label incorrectly
claims indefinite full-payload retention.

## 6. PR 4 - MCP Capability Catalog and File Ownership

### Goal

Reduce per-agent tool context and permission exposure without renaming tools,
changing schemas, merging CRUD operations into generic action tools, or
splitting the npm package.

### Catalog design

Define pure tool-name groups as the single source of truth:

- `core`: workspace, project, task, label, search, notes/assets, reports, and
  knowledge tools;
- `terminal`: task execution and terminal interaction;
- `workbench`: batch ACK, heartbeat, resolve, task-created confirmation, and
  gateway-work completion used by resident Workbenches;
- `gateway-query`: bounded NON_OWNER query/discussion tools;
- `gateway-owner`: OWNER routing, task-context resolution, explicit
  continuation, reply, provisioning, diagnosis, and recovery;
- `messaging`: task-to-human ask/notify/push tools;
- `operations`: runtime health and narrowly scoped recovery tools.

Profiles compose groups rather than duplicating string arrays:

- `full` - backward-compatible default;
- `assistant` - current in-process Assistant surface;
- `task` - core + terminal + messaging + Workbench tools needed by Tower task
  terminals;
- `gateway` - the union needed by the gateway process; sender-level OWNER versus
  NON_OWNER filtering remains mandatory in OpenClaw/Hermes;
- `gateway-query` - minimal read-only profile for a separately configured
  read-only bridge.

An MCP profile is an availability optimization and defense-in-depth boundary.
It does not replace runtime authorization, verified sender policy, or handler
ownership checks.

### Compatibility

- Default behavior remains the current full catalog.
- All 57 existing names and schemas remain compatible.
- Existing MCP configurations continue to work without adding a profile.
- Generated Tower Agent MCP configuration selects the bounded `gateway`
  profile where the host supports per-process environment configuration.
- Unknown profile values fail startup with a clear configuration error rather
  than silently exposing `full`.

### File split

Split `src/mcp/tools/harness-tools.ts` by responsibility:

```text
src/mcp/tools/harness/
  messaging-tools.ts
  gateway-query-tools.ts
  gateway-owner-tools.ts
  workbench-tools.ts
  operations-tools.ts
  shared.ts
  index.ts
```

Only adapter code moves. Business logic stays in `src/lib/harness`,
`src/lib/workbench`, actions, and internal routes. Do not create new business
abstractions solely to make files symmetrical.

### Single source of truth

- OpenClaw/Hermes allowlists consume the pure tool-name groups.
- MCP catalog tests verify every declared name exists exactly once.
- Role/profile tests verify no mutating OWNER tool appears in the read-only
  profile.
- Documentation tool lists and counts are generated from catalog metadata or
  checked against it in tests.
- `AGENTS.md`, Chinese docs, and English docs must stop carrying manually
  drifting totals.

### Verification

- `full` exposes the same 57 tools as before;
- `assistant` exposes the same 36 tools as before;
- gateway and query profiles expose only their declared unions;
- OWNER/NON_OWNER Tower Agent policy tests stay green;
- no tool name, schema, description, handler result, or error contract changes;
- MCP stdio smoke test succeeds for every profile;
- generated documentation count matches runtime output.

## 7. Delivery Order and Commit Boundaries

| Order | Branch / PR purpose | Dependency |
|---|---|---|
| 1 | `fix/ci-catalog-runner-context` | none |
| 2 | rebase and PR `codex/extensions-platform-v1` | PR 1 merged |
| 3 | `feat/operational-data-observation` | PR 2 merged to avoid schema/lock conflicts |
| 4 | `refactor/mcp-capability-catalog` | PR 3 merged; no semantic dependency |

Use English conventional commits with the repository module scope:

```text
fix(mcp): restore CI workflow startup
feat(settings): integrate extension platform foundation
feat(workbench): add bounded operational compaction
refactor(mcp): scope tool catalogs by runtime role
```

PR 3 may use `harness` instead of `workbench` if the final diff is predominantly
Gateway-owned; do not mix unrelated cleanup into the same commit.

## 8. Stop Conditions

Stop and request a new design review if implementation appears to require any
of the following:

- deleting or compacting any `WorkbenchEvent.payload` or identity row;
- making `DONE` or another task status globally irreversible to simplify
  maintenance;
- making Workbench maintenance query or understand Gateway-owned tables;
- changing at-least-once terminal delivery to exactly-once;
- adding a second database, broker, or background service;
- allowing extension packages to import Prisma or Tower internals;
- renaming/removing MCP tools or changing their public schemas;
- publishing packages or adding a second npm registry release path;
- extending the current Workbench/Gateway modular architecture beyond the
  maintenance and catalog work defined here.

## 9. Review Questions for Claude

1. After removing all `WorkbenchEvent.payload` compaction, does any recovery or
   idempotency path still depend on an old `RESOLVED` batch's duplicate `prompt`?
2. Are `GatewayInbound.content/response/lastError` and
   `GatewayDelivery.content/presentation/lastError` safe to compact only under
   the exact seven-day terminal predicates in §5.4, or does a post-window path
   still require one of those bodies?
3. Do the local atomic update predicates preserve the PR #26 ownership boundary
   without requiring Workbench-to-Gateway joins?
4. Are byte/count observations sufficient to decide whether each mutation earns
   its complexity, and should a negligible candidate set cause that mutation to
   be omitted?
5. Does the revised text accurately avoid claiming either proven database
   pressure or comprehensive sensitive-data erasure?
6. With PR 1 / 2 / 4 already approved, does this PR 3 revision resolve every
   blocking point from the first review?

## 10. First Claude Review (historical, independent, code-grounded)

> This section records the review of the previous draft. Its requested changes
> are addressed in §5, §8, §9, and the disposition in §11. It is intentionally
> retained so the second reviewer can verify the response rather than infer it
> from a rewritten history. Section references inside the historical review
> refer to the previous draft's numbering, not the revised §5 numbering.

> Reviewer: Claude. Author: Codex. Verified against the current tree, not just the prose.
> Verdict: PR 1 / 2 / 4 **APPROVE**. PR 3 **REVISE** — one load-bearing assumption to make
> explicit and one hard predicate to specify + test.

### Claims verified against code

| Plan claim | Check |
|---|---|
| Job-level `env` uses `${{ runner.temp }}`, fails at workflow startup | ✅ `.github/workflows/ci.yml:65-66`; `runner` is genuinely unavailable in `jobs.<id>.env`. Fix direction is correct. |
| `harness-tools.ts` exceeds 1,000 lines | ✅ 1,024 lines. |
| Recovery relies on durable **identity**, not payload | ✅ mostly. `requeueAbandonedWorkbenchEvent` (`gateway-router.ts`) only flips `CONSUMED → PENDING` and selects `{ id }`; it never reads the payload. |
| Requeue only fires for a non-terminal linked task | ✅ triggered solely under `linkedState === "IN_REVIEW"` (`gateway-router.ts:2453-2470`). |

### The one real risk (PR 3): "terminal" must be monotonic

PR 3's whole safety argument rests on this chain, which currently holds:

- CONSUMED-payload compaction is gated on *source task + linked Gateway chain terminal* (§5.3).
- The only path that resurrects a CONSUMED review event — `requeueAbandonedWorkbenchEvent` — fires
  only when the linked task is `IN_REVIEW` (non-terminal).
- So a compaction-eligible event is never a requeue candidate. Consistent.

**But note the hidden assumption:** requeue itself does not read the payload — the subsequent
**re-drain does** (`buildWorkbenchBatchPrompt` reads `event.payload`). So the payload is still
required *after* requeue. The guard is only safe if a task/chain that has reached a terminal state
**never returns** to a requeue-eligible state. If any path can move a linked task
`DONE → IN_REVIEW` (e.g. a late platform retry reopening it), an event whose payload was compacted
while terminal would later re-drain with an empty prompt.

Required before implementing PR 3:

1. Confirm no path resurrects a terminal task / Gateway chain into a requeue-eligible state. If one
   exists, the compaction predicate must exclude it, or add "terminal is monotonic" to §8 Stop
   Conditions and enforce it.
2. The "linked Gateway chain fully terminal" predicate (§5.3) is a join across
   WorkbenchEvent → source task → GatewayTaskLink → GatewayInbound → GatewayDelivery. It must be a
   **single-statement WHERE on the compaction UPDATE**, not a read-then-write. Add a §5.6 test:
   *a chain that flips from terminal back to non-terminal between selection and update is skipped.*

### Answers to §9

1. **Recovery field that PR 3 compacts?** Yes — re-drain after requeue reads `event.payload`.
   Covered by the guard *only under the monotonicity assumption above*. Make it explicit.
2. **Tombstones sufficient?** Yes. Identity (`dedupKey` / `executionReviewKey` / event IDs) is what
   recovery actually depends on; the `executionReviewKey` uniqueness guard (`coordinator.ts:341`)
   prevents review re-creation; idempotent ACK/resolve read state + id, never `prompt`.
3. **Gateway 7-day vs 24h?** Keep 7 days. The router's recent-session window is a hard dependency;
   shortening is a separate behavior change needing delayed-retry tests. Plan is correct.
4. **Rebase without scope change?** Yes. Conflict surface is CI / package version / lockfile (§3.3);
   scope guardrails are adequate. Low risk.
5. **Profiles match roles without weakening authz?** Yes. Profiles are stated as availability +
   defense-in-depth, not a replacement for runtime authz / verified-sender policy (§ catalog design).
6. **Cosmetic abstraction in the file split?** No. The plan explicitly forbids symmetry-only
   abstractions and keeps business logic out of the moved adapters.

### Minor (non-blocking)

- **PR 3 urgency lacks evidence.** No DB size / row-count growth is cited. The space half may be
  speculative; the **sensitive-data half (user message bodies retained indefinitely) is the real
  driver**. State that up front in §5 so the reader doesn't read it as solving imagined space
  pressure.
- PR 4 default `full` + fail-closed on unknown profile (§ compatibility) is the right call.
- Delivery order (PR 3 after PR 2 to avoid schema/lock conflicts) is sound.

## 11. Disposition of First Review and Second-Review Request

The first review was directionally correct: it identified that requeue itself
does not read the event payload but the later re-drain does. Follow-up code
inspection confirmed the hidden monotonicity assumption is false:

- `updateTaskStatus` accepts any `TaskStatus` without a transition matrix;
- MCP `move_task` delegates arbitrary status changes;
- terminal lifecycle callbacks can also write `IN_REVIEW` under their own local
  guards.

The revision deliberately does **not** enforce terminal monotonicity. That would
change task lifecycle semantics for the sake of storage cleanup and would be a
larger product decision than this hardening round permits.

The first review's proposed cross-chain atomic predicate is also not adopted for
Workbench events. For Gateway-originated work, the inbound identity can exist
inside generic `payload.sourceReference` rather than a relational
`WorkbenchEvent` foreign key. Teaching Workbench maintenance to decode that
payload and join `GatewayTaskLink`, `GatewayInbound`, and `GatewayDelivery` would
reintroduce the ownership coupling removed in PR #26.

The blocking comments are resolved as follows:

| First-review concern | Revised disposition |
|---|---|
| A compacted event may later be requeued and re-drained. | No `WorkbenchEvent.payload` is compacted in any state. |
| Safety depended on terminal status being monotonic. | The dependency is removed; task reopening remains supported. |
| Cross-chain eligibility must be atomic. | No cross-chain Workbench compaction exists. Workbench and Gateway use separate owner-local guarded updates. |
| Space pressure was asserted without evidence. | The plan now measures row counts and bytes first and permits omitting negligible mutations. |
| Sensitive-data reduction was overstated. | The plan now describes removal of selected duplicate operational bodies and explicitly lists other retained copies. |

Second review should evaluate the revised §5 rather than attempt to repair the
superseded consumed-event compaction design in §10. In particular, verify the
two remaining mutations independently:

1. `WorkbenchBatch.prompt` replacement only for rows still `RESOLVED` with
   `resolvedAt` older than 24 hours; and
2. Gateway-owned body replacement only after seven days under the exact
   terminal state and delivery-relation predicates.

PR 3 must remain unimplemented until this second review confirms those fields
are no longer needed by any post-window recovery, duplicate-response,
diagnostic, or delivery path.

## 12. Second Claude Review (code-grounded)

> Reviewer: Claude, round 2. The revision resolved both round-1 blockers, verified against code.
> Verdict: PR 1 / 2 / 4 **APPROVE**. PR 3 **APPROVE with one predicate tightening** below.

### Round-1 dispositions confirmed

- **Monotonicity claim is correct.** `updateTaskStatus` (`src/actions/task-actions.ts:62`) only
  `parse`s the enum — no transition matrix; `move_task` delegates arbitrary changes
  (`task-tools.ts:558`). `DONE → IN_REVIEW` is reachable. Dropping all `WorkbenchEvent.payload`
  compaction is the correct, safe response — better than the round-1 "guard it" suggestion.
- **Refusing the cross-table join is right.** Teaching Workbench maintenance to join Gateway tables
  would reverse PR #26's boundary. Owner-local guarded updates are the correct call.
- Measure-first (§5.3) and the de-scoped sensitive-data claim resolve the round-1 minors honestly.

### Mutation #1 — WorkbenchBatch.prompt (RESOLVED > 24h): APPROVE

Verified no live path reads a RESOLVED batch's prompt. `batch.prompt` is written only at batch
creation (`drainWorkbenchEvents`, state `CLAIMED`) and read only on the dispatch/deliver path
(`deliverWorkbenchBatchToParent`); every active-batch query filters
`state ∈ {CLAIMED, DISPATCHED, ACKED}` (`coordinator.ts:180,239`). ACK/resolve idempotency reads
state+id, never prompt. The prompt is reconstructable from the never-compacted event payloads.
Dead data at RESOLVED. Safe.

### Mutation #2 — Gateway bodies (> 7d): APPROVE with one tightening

Main paths are safe: the duplicate-callback cached-result parse
(`gateway-router.ts:1401 JSON.parse(inbound.response)`) is reached only when `state !== PROCESSED`,
while compaction only touches `PROCESSED` rows — those hit the early `already_processed` return
(`:1395`) and never parse the body. This relies on the marker being **non-null** (plan §5.4 already
requires it); keep that.

**Tightening (low severity, not a blocker):** the §5.4 `GatewayDelivery DELIVERED > 7d` rule guards
only on the delivery's own `state` + `deliveredAt`, whereas the sibling `GatewayInbound PROCESSED`
rule also requires "no related delivery nonterminal." That asymmetry leaves an edge: an inbound
stuck `QUEUED/PROCESSING` past 7 days (recovery scan `gateway-router.ts:2349` has no age filter)
whose `FINAL_RESULT` delivery is already `DELIVERED > 7d` and compacted → recovery copies the
marker into `inbound.response` (`:2448`), and a later continuation read
(`parseContinuationResult(current.response)`, `:954`) then parses a marker → `null`. Defensive
parsers prevent a crash, so this degrades rather than corrupts — but it is avoidable.

Fix: make `GatewayDelivery DELIVERED > 7d` compaction **also require its linked `GatewayInbound` to
be terminal (`PROCESSED`)**, symmetric to the inbound rule. Cheap predicate; makes the two Gateway
rules consistent and closes the stuck-inbound edge. Add a §5.7 test: a `DELIVERED` delivery whose
inbound is still `QUEUED/PROCESSING` is not compacted.

### Convergence

Converged at round 2 (within the 3-round cap). No open disagreement. PR 3 is safe to implement once
the delivery-compaction predicate is made inbound-terminal-symmetric; the rest stands as written.
Human gate: owner's go.

## 13. Final Disposition

The owner approved implementation after Round 2. The final §5.4 delivery rule
now includes the required linked-inbound `PROCESSED` predicate, §5.7 covers both
the rejecting and permitting cases, and §5.2 reuses the existing six-hour sweep
without a new timer or persisted scheduler state. No review finding remains
open. Implementation must preserve the four independent PR boundaries in §7.
