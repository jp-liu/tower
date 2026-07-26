# AI Tools 0.3 Requirement-to-Evidence Verification

> Baseline: `feat/ai-tools-0.3` at `2362a0c`
> Central acceptance worktree: `test/cms1hf3cc001fcmuhok2eswk9`
> Verification date: 2026-07-26

## Current centralized acceptance

This section supersedes the historical execution conclusion later in this file.
The current run used isolated HOME/data/SQLite roots, fake provider executables,
a fake OpenAI-compatible endpoint, and a local HTTPS Catalog. Production PID
58740 on port 3000 was not restarted, reused, or signalled.

| Gate | Current result | Evidence |
|---|---|---|
| Frozen workspace install | PASS | `pnpm install --frozen-lockfile --ignore-scripts --prefer-offline`; lockfile and workspace graph were current. |
| AI packages | PASS | 6 package typechecks/builds; SDK 15, Claude 10, Codex 11, Gemini 14, Runtime 149, Qwen 4: 203 tests. |
| Catalog contracts | PASS | Source/index schema, generated HTTPS fixture index, Qwen artifact checksum, Runtime contract, and install plan validation. |
| Root quality | PASS | Typecheck; ESLint 0 errors/0 warnings after removing ignored generated dist; Prisma generate/validate; 210 passed/6 skipped files and 2012 passed/27 todo tests. |
| Next standalone build | PASS | Multiple isolated builds passed with Next 16.2.1 and 8/8 static pages. After an unproxied font-download failure, an explicit `127.0.0.1:7897` proxy build passed with the original fonts. Product font configuration was restored exactly to baseline in `24ba6f8`; no system-font substitution remains. |
| Browser acceptance | PASS | Core serial run: Qwen Catalog/lifecycle/slot visibility, Settings/AI Tools, Assistant SSE/tool/attachment/cancel/error. Final visual run passed at 1440x900, 1280x720, and 390x844; five screenshots were inspected and deleted. |
| Package canary | PASS | 2042 files, 44,561,442 unpacked bytes. |
| Packaged release smoke | NOT COMPLETED | A proxied run reached Terminal and exposed two fixture defects, fixed in `94c1731` and `ad6fbff`. The final clean retry was again blocked by intermittent Google Fonts/font-file access during its internal build. No product workaround was retained; repeat on a stable proxy/cache before release. |
| Loopback default | PASS | `bin/network.mjs` still defaults to `127.0.0.1`; port 3000 remained owned by the original production process. |

Release-relevant defects fixed by this run are: local-directory Providers again
expose Test/Edit controls (`ff1cf23`); mobile Settings/Assistant layout no longer
collapses into a narrow clipped strip (`ff1cf23`); disabled dynamic Providers are
not offered for new capability targets while existing broken targets retain their
diagnostic (`6090ca2`). The E2E Catalog now covers ready/empty/unavailable states,
Qwen install/permission/enable/disable/re-enable/damage/uninstall, all five slot
selectors, and fake CLI missing/incompatible/compatible states (`ff1cf23`).

The optional read-only host smoke found `/Users/liujunping/.local/bin/qwen` and
parsed `0.21.0`, which satisfies `>=0.18.0 <1.0.0`. It ran with an isolated HOME,
cleared provider credential variables, closed stdin, and invoked only
`command -v qwen` plus `qwen --version`. It is not an automated pass condition.

This document is the release acceptance ledger for AI Tools 0.3. The authority is
`docs/ai/ai-tools-architecture-decisions.md`, the parent goal requirements copied
into task `cmrziyswt001bcms4n3exb0if`, and the focused implementation commits from
`ca0ce6c` through the final integrated HEAD beginning at `fd34d65`.

## Status rules

- **proved**: a named source invariant or an executed test/smoke directly proves
  the requirement. A passing neighboring test and "no issue found" are not proof.
- **failed**: direct evidence contradicts the requirement.
- **missing**: the required direct evidence has not been produced, including tests
  that exist in source but have not yet been run in this acceptance worktree.
- **accepted-deviation**: the hub accepted a historical verification-procedure
  deviation after a read-only impact audit; it is neither product proof nor a
  current release-gate failure.

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
| HOT-03 | Summary proves both CLI and API explicit-target execution. | `capability-entry-matrix.test.ts` directly drives Execution Summary and task overview through named CLI and API targets (2 tests); failure degradation remains covered by `execution-summary.test.ts` and `task-overview-capture.test.ts`. | proved |
| HOT-04 | Dreaming/task overview proves both CLI and API explicit-target execution and non-destructive degradation. | `capability-entry-matrix.test.ts` directly drives structured Dreaming through CLI and API targets; `dreaming-capture.test.ts` proves failure cannot block Done or create a damaged note. | proved |
| HOT-05 | Project analysis proves both CLI and API explicit-target execution and preserves original content on failure. | `capability-entry-matrix.test.ts` directly drives real `analyzeProjectDirectory` through CLI and API targets; project-action tests prove original description preservation on failure. | proved |
| HOT-06 | Assistant proves both CLI and API explicit-target execution. | `assistant-stream-executor.test.ts` uses explicit fake CLI targets and a separate explicit API target; full root run includes both. | proved |
| HOT-07 | Terminal proves built-in and third-party CLI plan execution while rejecting API targets. | `agent-actions-directive.test.ts`, `target-binding-routes.test.ts`, capability Runtime Terminal tests, and capability service API-target rejection all pass in the root run. | proved |
| HOT-08 | A fixture third-party CLI enters connection testing, slot resolution, Terminal, and query execution without source registration. | `cli-plugin-service.test.ts` copies an unregistered fixture, installs/confirms it, runs Hello/models, persists a connection, resolves the Summary and Terminal slots, then executes both capability and legacy query paths plus a Terminal plan in one test. | proved |

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
| CLI-01 | Claude/Codex/Gemini cover not-found, found, runnable, connected, and MCP unavailable. | `builtin-cli-contract-matrix.test.ts` applies the four command states and each provider's own Hello probe to all three built-ins (6/6 matrix tests); the direct provider suites assert their MCP-unavailable behavior (Claude 10, Codex 11, Gemini 14). | proved |
| CLI-02 | All built-ins cover model selection, fresh/resume/continue, generate/stream, tool call/result, and cancellation. | The same direct matrix asserts explicit model plans, model arrays, and cancellation for every provider; the three direct provider suites assert fresh/resume/continue, generate/stream, and tool-call/result framing. All 35 provider tests pass. | proved |
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
| SEC-01 | Key/header/query/CLI env/plugin-setting canaries never appear outside credential storage or explicit reveal. | Unified `secret-redaction.ts` is exercised at every required boundary: `secret-redaction`, `logger`, `capability-config-service`, `install-orchestrator`, Assistant route/session, adapter route, Terminal snapshot, TaskMessage, task-overview, and Dreaming canary tests. Credential storage/reveal is separately proved by SEC-05. | proved |
| SEC-02 | Prompt/tool/stderr/upstream-body/attachment-filename canaries are redacted from the same sinks. | Direct tests inject distinct canaries into prompts, tool input/result/error, provider stderr/upstream body, and attachment filenames, then inspect console, diagnostics, TaskMessage, AssistantMessage, install report, SSE/action response, Terminal snapshot, and both generated-note paths. The final 3-file addition is 35/35. | proved |
| SEC-03 | Plugin install logs and generated diagnostics contain no secret and plugins receive no unrelated Keys/database. | `install-orchestrator.test.ts` inspects a canary-failing install report; `provider-host.test.ts` proves unrelated sensitive env is excluded; `ai-sdk-contract.test.ts` rejects `database:read`; permission-bypass tests prove integrations are never invoked without declared permission. | proved |
| SEC-04 | Non-loopback internal requests, traversal, symlink escape, malicious schema, shell metacharacters, dangerous env keys, and permission bypass are rejected. | Localhost route tests, attachment/project symlink tests, config-schema/process-executor/plugin permission suites all pass. | proved |
| SEC-05 | Key mask/reveal/copy/edit returns the saved original only to explicit UI actions. | Final real-browser Settings flow asserts masked initial value, absence of plaintext in the dialog, explicit reveal, clipboard copy of the original, edit/save, reload persistence, and controlled connection test. | proved |
| SEC-06 | Full backup/restore preserves credentials and connection usability, with static risk text. | `backup-ai-tools.test.ts` uses real Prisma databases and archive/restore code across two temporary data roots, then verifies the original Key, models, all five targets, plugin registry/path rebasing, Assistant history, and a successful restored fake-upstream connection. Static warning remains in Settings/docs. | proved |

### Real browser acceptance

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| UI-01 | AI Tools layout and CRUD workflows work at 1440x900, 1280x720, and 390x844. | Final Playwright run (3/3) asserts Settings/Assistant layout and no horizontal overflow at desktop, laptop, and mobile. The same serial fake-provider run completes API CRUD and plugin install/config/disable/enable/uninstall. The original evidence screenshots were asserted/deleted once; the 2026-07-26 regression run explicitly asserted an empty screenshot directory. | proved |
| UI-02 | API multi-Key, model/manual/headers/query; plugin lifecycle/config; and target ordering/model/effort/diagnostics work and persist after reload. | Real browser executes Key mask/reveal/copy/edit/add/test, model refresh/manual add, headers/query, slot diagnostics/reorder, reload persistence, and the complete local fixture-plugin lifecycle including plan, permission, schema config, disable, enable, and uninstall. | proved |
| UI-03 | Long names/errors/models/Keys do not overflow; keyboard, focus, labels, and tooltips are usable; zh/en have no missing keys. | Browser seed includes long connection/model/error/Key values; DOM asserts no overflow, keyboard focus leaves body, every visible button has a label, capability icon hover exposes its tooltip, and both en/zh reload without untranslated keys. Focused final Settings rerun is 1/1. | proved |
| UI-04 | Assistant UI covers session create/switch/reload/rename/delete/binding, text/tool/attachment, cancel/error, and legacy import. | Real browser selects the imported legacy session, verifies history/tool card and workspace/project/version bindings, creates a fresh session, streams text, uploads an attachment, cancels a turn, observes a controlled error, then renames and deletes the session. Focused run is 1/1. | proved |

### Production package smoke and complete quality gate

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| REL-01 | Packaged `tower` binds only 127.0.0.1 by default. | Final `release:smoke` installed the tarball and served only `127.0.0.1:53229`; no wildcard test listener was opened. | proved |
| REL-02 | `--host 0.0.0.0` override resolves correctly without exposing a real machine port. | `bin/network.test.mjs` is included in the passing root suite; no wildcard listener was started by acceptance. | proved |
| REL-03 | Tarball install, first boot, migration, settings load, built-in registry, fixture plugin, fake connection/slot, and fake Summary/Assistant/Terminal plan work. | Final `release:smoke` installs the tarball from a local fixture registry, boots on a temporary loopback port, applies 13 migrations, loads Settings/built-ins, dynamically imports an unregistered local plugin, persists a fake API connection and all five slots, and executes packaged Summary, Assistant, and Terminal plans. | proved |
| REL-04 | Full restore to a second temporary data directory preserves Keys, targets, plugin registry, and Assistant sessions. | `backup-ai-tools.test.ts` directly restores the full archive into a second temporary root and verifies the Key/models, five targets, rebased plugin registry, Assistant session/messages, and post-restore fake API request. | proved |
| REL-05 | No real provider CLI/network/credentials, publish, tag, push, or organization action occurs. | Hub-accepted procedural deviation: an early discarded UI smoke inherited real `PATH` and invoked local CLI version/integration probes. The read-only audit found no user-config write, Provider network request, or credential use: `~/.claude.json` 2026-07-25 21:27:03, `~/.claude/settings.json` 2026-07-24 17:08:28, `~/.codex/config.toml` 2026-07-25 21:27:55, and `~/.gemini/settings.json` 2026-07-21 09:58:04. Every 2026-07-26 final gate used temporary HOME/data, fake CLI executables, and local fake HTTP; no publish/tag/push/org action occurred. | accepted-deviation |
| QG-01 | Full repository `pnpm test:run` passes with Harness injection variables cleared. | Final full run: 1950 passed, 19 failed, 27 todo across 204 passed/5 failed/6 skipped files. Eighteen failures were isolated outer-environment assumptions and one was a Select timing failure that passed independently without assertion changes; `b21667a` fixes the fixture assumptions and the instructed failed-file rerun is 5/5 files, 56/56 tests. Logical final aggregate is 209 passed/6 skipped files and 1969 passed/27 todo tests. `fd34d65`'s lightbox natural-dimensions/zoom/drag/backdrop regression test passed in the full run. | proved |
| QG-02 | `pnpm exec tsc --noEmit` passes. | Final root typecheck exit 0 after the integrated ESLint/UI lifecycle changes; all five AI package builds also exit 0. | proved |
| QG-03 | Full ESLint passes. | After removing 141 ignored, reproducible build artifacts left by earlier gates (without changing rules or ignores), `pnpm lint` exits 0 with 0 errors and 0 warnings. Integrated ESLint/UI lifecycle work is present through `fd34d65`. | proved |
| QG-04 | Prisma generate and validate pass against a temporary SQLite URL. | Combined generate/validate command exit 0. | proved |
| QG-05 | Every AI workspace package test and build passes. | Package tests exit 0: SDK 15, Claude 10, Codex 11, Gemini 14, Runtime 131 = 181; recursive builds exit 0. | proved |
| QG-06 | MCP build passes with root esbuild available. | Exit 0, 3.8 MB bundle; root `esbuild` declared by `5a08f6a`. | proved |
| QG-07 | Next production build passes without `generate is not a function`. | Raw inherited-shell `pnpm build` exit 0 after `710654b`; Next 16.2.1 compiled, typed, and generated 8/8 pages. | proved |
| QG-08 | Release pack canary and full release smoke pass. | `release:pack:check` exit 0 (2003 files/44,384,195 bytes); `release:smoke` exit 0 after local fixture registry install of 140 packages and verification of 13 migrations plus packaged fixture/API/Summary/Assistant/Terminal plans. | proved |
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
| 2026-07-25 | Capability entry + degradation focused suite | 0 | 44 passed, 3 todo | Includes 6 direct Summary/Dreaming/Analysis CLI+API entry tests and existing non-destructive paths. |
| 2026-07-25 | Dynamic plugin service | 0 | 4/4 | One unregistered local plugin crosses install, test, slot, query, and Terminal. |
| 2026-07-25 | Built-in CLI direct matrix | 0 | 6/6 | Two parameterized tests for each of Claude, Codex, and Gemini; direct provider packages remain 35/35. |
| 2026-07-25 | Secret boundary focused suite | 0 | 66/66 | Six files cover unified redaction, console, diagnostics, Assistant persistence/SSE, install report, and action response. |
| 2026-07-25 | TaskMessage/generated-note canaries | 0 | 35/35 | Three files directly inspect TaskMessage, task overview, and Dreaming note persistence. |
| 2026-07-25 | Full archive second-root restore | 0 | 1/1 | Real Prisma source/restored roots plus controlled local HTTP upstream. |
| 2026-07-25 | Final packaged `release:smoke` | 0 | 13 migrations + 3 plans | `127.0.0.1:49987`; fixture plugin, fake API, Summary, Assistant, Terminal verified; 1993-file/44.1 MB tarball, 140 local-registry packages. |
| 2026-07-25 | Final Settings + Assistant browser workflows | 0 | 3/3 | 27.4 s serial run; final three screenshots created once and removed. Additional expanded Settings 1/1 (20.3 s) and Assistant 1/1 (8.1 s) passed without screenshots. |
| 2026-07-25 | Tooltip browser assertion (role-name selector) | 1 | 0/1 | Product tooltip rendered without an accessible name; assertion selector corrected to direct visible content. Temporary process/data still removed by teardown. |
| 2026-07-25 | Corrected Settings tooltip/browser workflow | 0 | 1/1 | 21.2 s; accessible trigger label plus visible hover content, no screenshots. |
| 2026-07-25 | Read-only real-HOME impact audit | 0 | 4 mtimes | No timestamp evidence of CLI config writes; no user file was changed or restored. The hub later accepted REL-05 as a historical procedural deviation. |
| 2026-07-26 | Final full `pnpm test:run --maxWorkers=1` | 1 | 1950 passed, 19 failed, 27 todo | 204 passed/5 failed/6 skipped files in 205.72 s. The failures exposed outer HOME/DB assumptions and one Select timing failure; no product assertion failed. |
| 2026-07-26 | CLI plugin Select independent rerun | 0 | 5/5 | Confirmed the full-run Select failure was a timing-only test interaction; assertion was not relaxed. |
| 2026-07-26 | Failed-file rerun after `b21667a` | 0 | 56/56 | All five previously failing files under canonical temporary HOME/DB and fake CLI PATH. |
| 2026-07-26 | `pnpm lint` with stale ignored dist | 1 | 174 errors, 820 warnings | All 994 findings came from generated `dist` JavaScript left by earlier builds; no source finding. |
| 2026-07-26 | Clean-checkout-equivalent `pnpm lint` | 0 | 0 errors, 0 warnings | Removed 141 ignored/reproducible dist files; no ESLint rule or ignore change. |
| 2026-07-26 | AI package tests | 0 | 181/181 | SDK 15; Claude 10; Codex 11; Gemini 14; Runtime 131, all fake-only. |
| 2026-07-26 | `pnpm ai:packages:build` | 0 | 5/5 packages | Public SDK, private Runtime, and three built-in CLI providers. |
| 2026-07-26 | `pnpm exec tsc --noEmit` | 0 | root typecheck | Covers the integrated ESLint/UI lifecycle work through `fd34d65`. |
| 2026-07-26 | Prisma generate + validate | 0 | 2/2 commands | Prisma 6.19.2, temporary HOME/data/database; schema valid. |
| 2026-07-26 | `pnpm build` | 0 | 8/8 static pages | AI packages and 3.8 MB MCP bundle built; Next 16.2.1 compiled/typed successfully. Eight known NFT trace warnings remain. |
| 2026-07-26 | `pnpm release:pack:check` | 0 | 2003 files | 44,384,195 unpacked bytes. |
| 2026-07-26 | `pnpm release:smoke` | 0 | 13 migrations + 3 plans | 140 local-registry packages; loopback `127.0.0.1:53229`; fixture plugin, API, Summary, Assistant, Terminal verified. |
| 2026-07-26 | Final fake-only Playwright E2E | 0 | 3/3 | Settings 16.9 s, Assistant 3.2 s, three-viewports 1.0 s; 24.8 s total. Screenshot directory asserted empty. |
| 2026-07-26 | Final port/process/temp audit | 0 | 4 cleanup classes | No test listener/process/temp root remains; production PID 58740 on port 3000 is unchanged. |

## Defects and fixes

Release-relevant fixes are committed separately: workspace test resolution
(`fcc62ec`, `d414030`), atomic migrations (`d148397`), legacy Assistant bypass
removal (`e6c6a9b`), explicit CLI connection safety (`d164dae`), redaction
boundaries (`f814ec5`, `09b3154`, `57276c6`), backup completeness (`c164158`),
root esbuild (`5a08f6a`), inherited Next build isolation (`710654b`), offline
tarball smoke (`0e52c9e`), packaged dynamic imports (`872a4ac`), first-turn
Assistant attachments/session payloads (`9ae9253`, `7513aa5`), and global
icon/button binding labels (`931ec30`, `7513aa5`). Contract/browser evidence is
split across `1132e7c`, `69dfd3a`, `4a24e3e`, `02972f3`, and `f9e6d55`.
The hub-accepted ESLint integration through `fd34d65` adds the lightbox
dimensions regression; `b21667a` makes the final gate independent of real HOME
and outer database formatting, while `07fc33b` prevents duplicate screenshots.

## Final process and artifact audit

Final audit confirms production PID 58740 remains on port 3000 with cwd
`/Users/liujunping/project/f/tower/.next/standalone`. All temporary Tower
acceptance ports (49987, 53229, 55072, 55662, 57239, 59638 and failed-attempt ports),
Playwright Chromium processes, fixture registries, and `tower-{smoke,ui}-*`
directories are gone. Two failed-browser-attempt roots that retained only empty
temporary `home/.gemini` directories were removed with exact-path `rmdir` during
the final audit. Temporary screenshots and runtime databases were not committed.

## Final status

**Central acceptance conclusion: CONDITIONAL PASS for manual acceptance; do not
publish v0.3.0 yet.** Core AI Tools, Extensions, Qwen fixture integration,
capability routing, Assistant, package contracts, root tests, and browser flows
passed. The remaining automated release prerequisite is a packaged smoke in a
build environment with Google Fonts access or an approved font cache. This run
did not publish, push, tag, create a GitHub Organization, configure a production
Catalog, access a real Provider account, send a real prompt, or consume quota.

The official Catalog repository/Organization/hosted URL is still unauthorized.
Until it exists, operators must configure the server-side
`TOWER_EXTENSION_CATALOG_URL` or the system Catalog URL. Manual acceptance items
and external prerequisites are maintained in
`docs/guide/acceptance-0.3.0.md`.
