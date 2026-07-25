# AI Tools 0.3 Requirement-to-Evidence Verification

> Baseline: `feat/ai-tools-0.3` at `f2be6141715661f466ba1242e2df8db8807ed09c`
> Acceptance worktree: `test/cmrziyswt001bcms4n3exb0if`
> Verification date: 2026-07-25

This document is the release acceptance ledger for AI Tools 0.3. The authority is
`docs/ai/ai-tools-architecture-decisions.md`, the parent goal requirements copied
into task `cmrziyswt001bcms4n3exb0if`, and the focused implementation commits from
`ca0ce6c` through `f2be614`.

## Status rules

- **proved**: a named source invariant or an executed test/smoke directly proves
  the requirement. A passing neighboring test and "no issue found" are not proof.
- **failed**: direct evidence contradicts the requirement.
- **missing**: the required direct evidence has not been produced, including tests
  that exist in source but have not yet been run in this acceptance worktree.

Command exit codes and observed test counts are recorded in the execution ledger
below. All runtime tests must use fake providers, temporary directories, temporary
ports, and no real credentials or provider network.

## Requirement matrix

### Architecture, packaging, and release scope

| ID | Requirement | Direct evidence | Status |
|---|---|---|---|
| ARC-01 | Public CLI SDK and private host Runtime are separate packages. | `packages/ai-sdk/package.json` exports the public contract; `packages/ai-runtime/package.json` is the private host runtime and depends on the SDK. | proved |
| ARC-02 | Claude, Codex, and Gemini use the public plugin contract, without a private built-in route. | Each `packages/ai-provider-{claude,codex,gemini}/src/index.ts` imports `defineCliPlugin` from `@tower/ai-sdk`; focused commits `31d1beb`, `59c7654`. | proved |
| ARC-03 | API calls use the thin Runtime adapter for OpenAI, OpenAI Compatible, Anthropic, and Google. | `packages/ai-runtime/src/api-types.ts` defines exactly four protocols; `api-adapter.ts` constructs all four Vercel AI SDK providers. Runtime request proof is API-01..04. | proved |
| ARC-04 | Five explicit capability slots exist: Terminal, Summary, Dreaming, Analysis, Assistant. | `packages/ai-runtime/src/capability-types.ts` defines the exact five-slot tuple; `prisma/schema.prisma` persists capability targets. Runtime proof is SLOT-01..04. | proved |
| ARC-05 | Connection instances, models, multi-Key state, targets, plugins, Terminal snapshots, and Assistant history are persisted. | `prisma/schema.prisma`; migrations `0009` through `0013`. Data-preservation proof is MIG-01..06. | proved |
| ARC-06 | First release remains local/workspace-only and performs no external publish, tag, organization, or registry creation. | All five AI package manifests have `private: true`; `docs/guide/release-0.3.0.md` says no publish/tag/release; acceptance commands exclude publish/tag/push. | proved |
| ARC-07 | User and upgrade documentation covers 0.3.0, setup, migration, security, plugin trust, and limitations in zh/en. | `docs/{guide,en/guide}/{ai-tools,cli-provider-sdk,release-0.3.0,upgrade-0.3}.md`; commit `2a57537`. | proved |
| ARC-08 | Production CLI defaults to loopback and supports an explicit host override. | `bin/network.mjs`, `bin/tower.mjs`, README zh/en. Runtime proof is REL-01 and REL-02. | proved |
| ARC-09 | API models are discovered plus manually addable; Base URL is not rewritten with `/v1`. | `packages/ai-runtime/src/api-adapter.ts`, `api-config.ts`; runtime proof is API-05. | proved |
| ARC-10 | API Keys are local plaintext, masked by default, revealable/copyable/editable, and included in full backup with a static warning. | Schema and `src/components/settings/{api-connections-section,backup-section}.tsx`; docs. UI/backup proof is SEC-05 and UI-02. | proved |

### Hot-path audit and cross-module routing

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| HOT-01 | Business hot paths have no direct Claude Agent SDK dependency bypassing Runtime. | `rg` audit found the SDK only in `assistant-legacy-adapter.ts` and legacy metadata/import code. The obsolete server action was removed in `e6c6a9b`; the old route now returns localhost-only 410. | proved |
| HOT-02 | Business hot paths do not directly spawn `claude` or use legacy `assistant.model`, legacy `CliProfile` defaults, static first-provider selection, or implicit fallback. | Reviewed `src/lib/ai/{capability-resolver,capability-executor,terminal-target}.ts`; empty plans return `slot_unconfigured`. Removed stale config defaults and Claude-only connection fallback in `e6c6a9b`/`d164dae`; root tests pass. | proved |
| HOT-03 | Summary proves both CLI and API explicit-target execution. | Failure/degradation tests exist, but no direct cross-module test names both CLI and API Summary targets. | missing |
| HOT-04 | Dreaming/task overview proves both CLI and API explicit-target execution and non-destructive degradation. | `dreaming-capture.test.ts` proves non-destructive failure, but no direct CLI+API entry matrix was produced. | missing |
| HOT-05 | Project analysis proves both CLI and API explicit-target execution and preserves original content on failure. | Context/security tests exist, but no direct CLI+API project-analysis entry matrix was produced. | missing |
| HOT-06 | Assistant proves both CLI and API explicit-target execution. | `assistant-stream-executor.test.ts` uses explicit fake CLI targets and a separate explicit API target; full root run includes both. | proved |
| HOT-07 | Terminal proves built-in and third-party CLI plan execution while rejecting API targets. | `agent-actions-directive.test.ts`, `target-binding-routes.test.ts`, capability Runtime Terminal tests, and capability service API-target rejection all pass in the root run. | proved |
| HOT-08 | A fixture third-party CLI enters connection testing, slot resolution, Terminal, and query execution without source registration. | Plugin registration and Terminal/query pieces are tested separately; no one dynamic fixture crosses all four entry points. | missing |

### Migration matrix

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| MIG-01 | Fresh empty SQLite upgrades through every migration. | `tests/unit/scripts/ai-tools-migration-matrix.test.ts`: fresh temporary SQLite, all 13 migrations, second run. | proved |
| MIG-02 | Representative 0.2.60 data preserves CliProfile, AgentConfig, TaskExecution, and legacy Claude metadata. | Same matrix seeds a real legacy schema and asserts rows/metadata after upgrade. | proved |
| MIG-03 | Databases stopped after 0009 or 0010 resume correctly. | Same matrix runs partial ledgers through 0010 and then completes/repeats the ledger. | proved |
| MIG-04 | Re-running all migrations on a fully upgraded database is idempotent. | Every matrix case runs the complete migration runner twice and compares rows/ledger. | proved |
| MIG-05 | API multi-Key, capability targets, plugin Connection config, Terminal target snapshots, and Assistant sessions/messages survive migration. | Matrix plus focused 0009-0013 migration tests assert rows, unique indexes, and foreign keys. | proved |
| MIG-06 | IDs are unique/ordered and a failed migration leaves neither ledger nor schema half-state. | Migration runner discovery tests plus injected 0013 failure; `d148397` wraps schema+ledger in one transaction. | proved |

### Provider, fallback, Terminal, and Assistant contracts

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| CLI-01 | Claude/Codex/Gemini cover not-found, found, runnable, connected, and MCP unavailable. | Provider tests and fake browser discovery cover subsets, but not the complete state matrix for each built-in. | missing |
| CLI-02 | All built-ins cover model selection, fresh/resume/continue, generate/stream, tool call/result, and cancellation. | 35 provider tests cover plans/streams/tools/MCP; cancellation and every facet are not directly asserted for every provider. | missing |
| API-01 | OpenAI request URL/header/query/body, stream, structured output, and tools are correct. | `packages/ai-runtime/test/api-runtime.test.ts` exact four-protocol construction, controlled fetch, streaming, structured/tool loop tests; 131 Runtime tests pass. | proved |
| API-02 | OpenAI Compatible request URL/header/query/body, stream, structured output, and tools are correct. | Same four-protocol Runtime matrix. | proved |
| API-03 | Anthropic request URL/header/query/body, stream, structured output, and tools are correct. | Same four-protocol Runtime matrix. | proved |
| API-04 | Google request URL/header/query/body, stream, structured output, and tools are correct. | Same four-protocol Runtime matrix. | proved |
| API-05 | Base URL is not given `/v1`; discover/manual models coexist and stale selected models remain diagnosable. | Runtime exact-base-URL/discovery tests and settings model/capability guard tests pass. | proved |
| KEY-01 | Only enabled+ok Keys participate and starting Key round-robins. | Runtime multi-Key candidate and concurrent reservation tests pass; order assertion was stabilized in `9177e79`. | proved |
| KEY-02 | 401/403/429 rotate before activity; other errors and any error after activity do not rotate. | `api-runtime.test.ts` generate/stream/tool-side-effect/cancellation boundaries pass. | proved |
| SLOT-01 | Targets run only in configured order; no config returns `slot_unconfigured`; no first-provider fallback. | `capability-runtime.test.ts` empty slot and ordered explicit fallback tests pass. | proved |
| SLOT-02 | Fallback is allowed before first text/reasoning/tool/side effect and locked afterward. | Capability stream and API multi-Key activity-boundary tests pass. | proved |
| SLOT-03 | Structured JSON/markdown repair stays on the target once before explicit fallback. | Capability Runtime repair-once test passes. | proved |
| SLOT-04 | Context limits and degradation do not break Done/stop/import flows. | Execution Summary, Dreaming capture, Assistant context window, and migration failure tests pass in the root suite. | proved |
| TERM-01 | One Terminal request creates one execution/worktree; pre-start failure may change target. | `agent-actions-directive.test.ts` and Runtime Terminal helper tests pass. | proved |
| TERM-02 | After spawn, connection/model are fixed; resume/continue/session-not-found fresh retry never changes target. | Terminal target-binding route, migration, provider-plan, and fixed-session Runtime tests pass. | proved |
| AST-01 | Assistant rereads slot each turn and keeps Tower DB history across Providers. | Assistant stream executor resolves each turn; session service persists provider-neutral history. | proved |
| AST-02 | Tool side effects are not replayed; SSE order, disconnect, abort, error, and persistence are correct. | Assistant session, stream, route, hook, and WS suites pass in the 210-file root run. | proved |
| AST-03 | Legacy Claude session import is idempotent. | `assistant-legacy-adapter.test.ts`, session-service legacy tests, and 0013 migration tests pass. | proved |

### Secret redaction and security attacks

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| SEC-01 | Key/header/query/CLI env/plugin-setting canaries never appear outside credential storage or explicit reveal. | Runtime/API and Assistant DB canary tests pass, but no single sweep inspected every required sink (console, install log, snapshots, notes). | missing |
| SEC-02 | Prompt/tool/stderr/upstream-body/attachment-filename canaries are redacted from the same sinks. | `f814ec5` redacts persisted tool/error/query data and opaque attachment names; exhaustive all-sink adversarial sweep is still absent. | missing |
| SEC-03 | Plugin install logs and generated diagnostics contain no secret and plugins receive no unrelated Keys/database. | Permission tests pass, but install-log canary inspection and unrelated-Key negative proof are incomplete. | missing |
| SEC-04 | Non-loopback internal requests, traversal, symlink escape, malicious schema, shell metacharacters, dangerous env keys, and permission bypass are rejected. | Localhost route tests, attachment/project symlink tests, config-schema/process-executor/plugin permission suites all pass. | proved |
| SEC-05 | Key mask/reveal/copy/edit returns the saved original only to explicit UI actions. | Action/component tests exist; real browser did not execute the complete Key workflow. | missing |
| SEC-06 | Full backup/restore preserves credentials and connection usability, with static risk text. | Backup unit coverage and static warning exist; no second-directory production restore smoke was run. | missing |

### Real browser acceptance

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| UI-01 | AI Tools layout and CRUD workflows work at 1440x900, 1280x720, and 390x844. | Final Playwright run proves layout at all three viewports, but does not complete every CRUD workflow. | missing |
| UI-02 | API multi-Key, model/manual/headers/query; plugin lifecycle/config; and target ordering/model/effort/diagnostics work and persist after reload. | Component tests pass; the required end-to-end browser action matrix was not run. | missing |
| UI-03 | Long names/errors/models/Keys do not overflow; keyboard, focus, labels, and tooltips are usable; zh/en have no missing keys. | Final run proves zero page overflow, zero unnamed visible buttons, correct order, and zh/en reload at three viewports; long/error/Key stress and tooltip keyboard traversal remain unproved. | missing |
| UI-04 | Assistant UI covers session create/switch/reload/rename/delete/binding, text/tool/attachment, cancel/error, and legacy import. | Component/route tests pass; no real-browser fake stream workflow was run. | missing |

### Production package smoke and complete quality gate

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| REL-01 | Packaged `tower` binds only 127.0.0.1 by default. | `release:smoke` installed the tarball and served only `127.0.0.1:55072`; final browser smoke used `127.0.0.1:59638`. | proved |
| REL-02 | `--host 0.0.0.0` override resolves correctly without exposing a real machine port. | `bin/network.test.mjs` is included in the passing root suite; no wildcard listener was started by acceptance. | proved |
| REL-03 | Tarball install, first boot, migration, settings load, built-in registry, fixture plugin, fake connection/slot, and fake Summary/Assistant/Terminal plan work. | Tarball install/boot/13 migrations/built-in registry/settings load pass; fixture plugin and three fake plans were not exercised in the packaged process. | missing |
| REL-04 | Full restore to a second temporary data directory preserves Keys, targets, plugin registry, and Assistant sessions. | No second-directory production restore was run. | missing |
| REL-05 | No real provider CLI/network/credentials, publish, tag, push, or organization action occurs. | No Provider network/credential/publish/tag/push/org action occurred, but an early discarded UI smoke inherited PATH and startup discovery invoked real CLI version/integration probes before it was stopped. | failed |
| QG-01 | Full repository `pnpm test:run` passes with Harness injection variables cleared. | Final exact command exit 0: 204 passed + 6 skipped files; 1947 passed + 27 todo tests. `4b0e8b2` serializes fork-heavy fixtures. | proved |
| QG-02 | `pnpm exec tsc --noEmit` passes. | Exit 0 after package and path fixes. | proved |
| QG-03 | Full ESLint passes. | `pnpm lint` exit 1: 161 errors and 72 warnings (233 findings), including stable pre-existing React/TypeScript lint failures. | failed |
| QG-04 | Prisma generate and validate pass against a temporary SQLite URL. | Combined generate/validate command exit 0. | proved |
| QG-05 | Every AI workspace package test and build passes. | Package tests exit 0: SDK 15, Claude 10, Codex 11, Gemini 14, Runtime 131 = 181; recursive builds exit 0. | proved |
| QG-06 | MCP build passes with root esbuild available. | Exit 0, 3.8 MB bundle; root `esbuild` declared by `5a08f6a`. | proved |
| QG-07 | Next production build passes without `generate is not a function`. | Raw inherited-shell `pnpm build` exit 0 after `710654b`; Next 16.2.1 compiled, typed, and generated 8/8 pages. | proved |
| QG-08 | Release pack canary and full release smoke pass. | `release:pack:check` exit 0 (1993 files/44,118,920 bytes); `release:smoke` exit 0 after local fixture registry install of 140 packages. | proved |
| QG-09 | `git diff --check` passes. | Repeated after each commit and in final audit, exit 0. | proved |
| QG-10 | Production port 3000 remains untouched and all acceptance servers/browsers/processes/ports are gone. | Final process/socket audit below; production PID 58740 remains listening on 3000. | proved |

## Execution ledger

| Time | Command or evidence | Exit | Tests/assertions | Notes |
|---|---|---:|---:|---|
| 2026-07-25 | `pwd`; branch/root/HEAD/status checks | 0 | 4 invariants | Correct isolated worktree, clean baseline at `f2be614`. |
| 2026-07-25 | Static source/package/document inventory | 0 | 10 static requirements | Establishes ARC-01..10 only; does not substitute for runtime proof. |
| 2026-07-25 | Focused migration matrix | 0 | 3/3 | Fresh, legacy 0.2.60, partial 0010; every case repeats all migrations. |
| 2026-07-25 | AI package tests | 0 | 181/181 | SDK 15; Claude 10; Codex 11; Gemini 14; Runtime 131. |
| 2026-07-25 | AI package builds | 0 | 5 packages | SDK, Runtime, and three built-ins. |
| 2026-07-25 | `pnpm exec tsc --noEmit` | 0 | typecheck | Final explicit run. |
| 2026-07-25 | `pnpm lint` | 1 | 161 errors, 72 warnings | Stable full-repository gate failure; QG-03 failed. |
| 2026-07-25 | Prisma generate + validate | 0 | 2 commands | Validate used temporary SQLite URL. |
| 2026-07-25 | `pnpm mcp:build` | 0 | 3.8 MB | Historical missing-root-esbuild blocker fixed. |
| 2026-07-25 | `pnpm build` | 0 | 8/8 static pages | Historical inherited standalone-config `generate` blocker fixed. |
| 2026-07-25 | `pnpm release:pack:check` | 0 | 1993 files | 44,118,920 unpacked bytes. |
| 2026-07-25 | `pnpm release:smoke` | 0 | 13 migrations, 140 dependency packages | Temporary npm prefix/cache/HOME/data/port; built-in connection present. |
| 2026-07-25 | Final Playwright fake-CLI smoke | 0 | 3 viewports + locale reload | 1440x900, 1280x720, 390x844; no overflow/unnamed buttons/browser errors; screenshots deleted in finally. |
| 2026-07-25 | First final root run | 1 | 1916 passed, 2 failed, 27 todo; 4 worker errors | Resource-starved Preview waits/workers; isolated 5-file rerun was 35/35. |
| 2026-07-25 | Second root run (`maxWorkers=4`) | 1 | 1938 passed, 2 failed, 27 todo; 1 worker error | Still nondeterministic under concurrent Tower workload. |
| 2026-07-25 | Final exact `pnpm test:run` (`maxWorkers=1`) | 0 | 1947 passed, 27 todo | 204 passed/6 skipped of 210 files; 197.31 s. |

## Defects and fixes

Release-relevant fixes are committed separately: workspace test resolution
(`fcc62ec`, `d414030`), atomic migrations (`d148397`), legacy Assistant bypass
removal (`e6c6a9b`), explicit CLI connection safety (`d164dae`), Assistant
redaction (`f814ec5`), stable acceptance coverage (`9177e79`, `4b0e8b2`), root
esbuild (`5a08f6a`), inherited Next production build isolation (`710654b`),
offline local-registry tarball smoke (`0e52c9e`), and icon-button labels
(`931ec30`).

## Final process and artifact audit

Final audit confirms production PID 58740 remains on port 3000. All temporary
Tower acceptance ports (55072, 55662, 57239, 59638 and failed-attempt ports),
Chromium processes, fixture registries, and `tower-{smoke,ui}-*` directories were
closed/removed. Temporary screenshots and runtime databases were not committed.

## Final status

**48 proved / 2 failed / 17 missing (67 total).** This gate is not complete:
QG-03 (full ESLint) and REL-05 (strict fake-only execution) failed, while the
remaining missing items require dedicated end-to-end CLI state, all-sink secret,
full browser CRUD/Assistant, packaged fixture-plugin/plan, and backup/restore
evidence. The task must remain in review until those requirements are proved.
