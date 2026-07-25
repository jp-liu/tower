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
| HOT-01 | Business hot paths have no direct Claude Agent SDK dependency bypassing Runtime. | Repository search with an allowlist for legacy adapter and compatibility code, plus reviewed call graph. | missing |
| HOT-02 | Business hot paths do not directly spawn `claude` or use legacy `assistant.model`, legacy `CliProfile` defaults, static first-provider selection, or implicit fallback. | Repository search with exact findings and reviewed allowlist. | missing |
| HOT-03 | Summary proves both CLI and API explicit-target execution. | Cross-module fake smoke/test naming both target kinds. | missing |
| HOT-04 | Dreaming/task overview proves both CLI and API explicit-target execution and non-destructive degradation. | Cross-module fake smoke/test naming both target kinds. | missing |
| HOT-05 | Project analysis proves both CLI and API explicit-target execution and preserves original content on failure. | Cross-module fake smoke/test naming both target kinds. | missing |
| HOT-06 | Assistant proves both CLI and API explicit-target execution. | Provider-neutral session/stream integration test with both target kinds. | missing |
| HOT-07 | Terminal proves built-in and third-party CLI plan execution while rejecting API targets. | Fake PTY/query execution test using explicit targets. | missing |
| HOT-08 | A fixture third-party CLI enters connection testing, slot resolution, Terminal, and query execution without source registration. | Dynamically registered local fixture plugin smoke. | missing |

### Migration matrix

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| MIG-01 | Fresh empty SQLite upgrades through every migration. | Automated temporary-SQLite matrix. | missing |
| MIG-02 | Representative 0.2.60 data preserves CliProfile, AgentConfig, TaskExecution, and legacy Claude metadata. | Seeded v0.2.60 fixture and post-migration assertions. | missing |
| MIG-03 | Databases stopped after 0009 or 0010 resume correctly. | Partial-ledger fixtures and post-migration assertions. | missing |
| MIG-04 | Re-running all migrations on a fully upgraded database is idempotent. | Second complete run, unchanged data assertions. | missing |
| MIG-05 | API multi-Key, capability targets, plugin Connection config, Terminal target snapshots, and Assistant sessions/messages survive migration. | Post-migration row, FK, index, and uniqueness assertions. | missing |
| MIG-06 | IDs are unique/ordered and a failed migration leaves neither ledger nor schema half-state. | Migration discovery assertion and injected-failure transaction test. | missing |

### Provider, fallback, Terminal, and Assistant contracts

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| CLI-01 | Claude/Codex/Gemini cover not-found, found, runnable, connected, and MCP unavailable. | Fake executable matrix; no real CLI. | missing |
| CLI-02 | All built-ins cover model selection, fresh/resume/continue, generate/stream, tool call/result, and cancellation. | Provider package contract matrix. | missing |
| API-01 | OpenAI request URL/header/query/body, stream, structured output, and tools are correct. | Mock HTTP/transport assertions. | missing |
| API-02 | OpenAI Compatible request URL/header/query/body, stream, structured output, and tools are correct. | Mock HTTP/transport assertions. | missing |
| API-03 | Anthropic request URL/header/query/body, stream, structured output, and tools are correct. | Mock HTTP/transport assertions. | missing |
| API-04 | Google request URL/header/query/body, stream, structured output, and tools are correct. | Mock HTTP/transport assertions. | missing |
| API-05 | Base URL is not given `/v1`; discover/manual models coexist and stale selected models remain diagnosable. | Runtime and settings tests. | missing |
| KEY-01 | Only enabled+ok Keys participate and starting Key round-robins. | Runtime multi-Key matrix. | missing |
| KEY-02 | 401/403/429 rotate before activity; other errors and any error after activity do not rotate. | Generate/stream activity-boundary matrix. | missing |
| SLOT-01 | Targets run only in configured order; no config returns `slot_unconfigured`; no first-provider fallback. | Capability Runtime contract test. | missing |
| SLOT-02 | Fallback is allowed before first text/reasoning/tool/side effect and locked afterward. | Event-boundary matrix. | missing |
| SLOT-03 | Structured JSON/markdown repair stays on the target once before explicit fallback. | Summary/Dreaming/Analysis contract test. | missing |
| SLOT-04 | Context limits and degradation do not break Done/stop/import flows. | Cross-module failure-path tests. | missing |
| TERM-01 | One Terminal request creates one execution/worktree; pre-start failure may change target. | Agent action fake PTY tests. | missing |
| TERM-02 | After spawn, connection/model are fixed; resume/continue/session-not-found fresh retry never changes target. | Agent action fake PTY tests. | missing |
| AST-01 | Assistant rereads slot each turn and keeps Tower DB history across Providers. | Session/turn integration tests. | missing |
| AST-02 | Tool side effects are not replayed; SSE order, disconnect, abort, error, and persistence are correct. | Route/executor integration tests. | missing |
| AST-03 | Legacy Claude session import is idempotent. | Seeded legacy import test. | missing |

### Secret redaction and security attacks

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| SEC-01 | Key/header/query/CLI env/plugin-setting canaries never appear outside credential storage or explicit reveal. | Canary sweep over logs, diagnostics, DB messages, SSE/actions, snapshots, and notes. | missing |
| SEC-02 | Prompt/tool/stderr/upstream-body/attachment-filename canaries are redacted from the same sinks. | Adversarial fake provider sweep. | missing |
| SEC-03 | Plugin install logs and generated diagnostics contain no secret and plugins receive no unrelated Keys/database. | Fixture plugin permission/context test. | missing |
| SEC-04 | Non-loopback internal requests, traversal, symlink escape, malicious schema, shell metacharacters, dangerous env keys, and permission bypass are rejected. | Security contract matrix. | missing |
| SEC-05 | Key mask/reveal/copy/edit returns the saved original only to explicit UI actions. | Browser plus action assertions. | missing |
| SEC-06 | Full backup/restore preserves credentials and connection usability, with static risk text. | Temporary-dir backup/restore smoke and settings DOM assertion. | missing |

### Real browser acceptance

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| UI-01 | AI Tools layout and CRUD workflows work at 1440x900, 1280x720, and 390x844. | One short-lived Playwright run, screenshots inspected but not committed. | missing |
| UI-02 | API multi-Key, model/manual/headers/query; plugin lifecycle/config; and target ordering/model/effort/diagnostics work and persist after reload. | Browser actions and DOM assertions against temporary data. | missing |
| UI-03 | Long names/errors/models/Keys do not overflow; keyboard, focus, labels, and tooltips are usable; zh/en have no missing keys. | Three-viewport DOM/accessibility assertions. | missing |
| UI-04 | Assistant UI covers session create/switch/reload/rename/delete/binding, text/tool/attachment, cancel/error, and legacy import. | Fake stream browser workflow. | missing |

### Production package smoke and complete quality gate

| ID | Requirement | Direct evidence required | Status |
|---|---|---|---|
| REL-01 | Packaged `tower` binds only 127.0.0.1 by default. | Temporary tarball install plus socket checks. | missing |
| REL-02 | `--host 0.0.0.0` override resolves correctly without exposing a real machine port. | Unit/subprocess network resolution test only. | missing |
| REL-03 | Tarball install, first boot, migration, settings load, built-in registry, fixture plugin, fake connection/slot, and fake Summary/Assistant/Terminal plan work. | Extended `release:smoke` in temporary HOME/data/port. | missing |
| REL-04 | Full restore to a second temporary data directory preserves Keys, targets, plugin registry, and Assistant sessions. | Extended production smoke assertions. | missing |
| REL-05 | No real provider CLI/network/credentials, publish, tag, push, or organization action occurs. | Command ledger and fake-only smoke configuration. | missing |
| QG-01 | Full repository `pnpm test:run` passes with Harness injection variables cleared. | Exit code and Vitest file/test counts. | missing |
| QG-02 | `pnpm exec tsc --noEmit` passes. | Exit code. | missing |
| QG-03 | Full ESLint passes. | `pnpm lint` exit code and finding count. | missing |
| QG-04 | Prisma generate and validate pass against a temporary SQLite URL. | Exit codes. | missing |
| QG-05 | Every AI workspace package test and build passes. | Recursive package command exit codes and counts. | missing |
| QG-06 | MCP build passes with root esbuild available. | `pnpm mcp:build` exit code. | missing |
| QG-07 | Next production build passes without `generate is not a function`. | `pnpm build` exit code. | missing |
| QG-08 | Release pack canary and full release smoke pass. | `pnpm release:pack:check` and `pnpm release:smoke` exit codes. | missing |
| QG-09 | `git diff --check` passes. | Exit code. | missing |
| QG-10 | Production port 3000 remains untouched and all acceptance servers/browsers/processes/ports are gone. | Before/after `lsof` and process audit. | missing |

## Execution ledger

| Time | Command or evidence | Exit | Tests/assertions | Notes |
|---|---|---:|---:|---|
| 2026-07-25 | `pwd`; branch/root/HEAD/status checks | 0 | 4 invariants | Correct isolated worktree, clean baseline at `f2be614`. |
| 2026-07-25 | Static source/package/document inventory | 0 | 10 static requirements | Establishes ARC-01..10 only; does not substitute for runtime proof. |

## Defects and fixes

No defects have been classified yet. Each release-relevant defect will be linked
to a focused English conventional commit and to the requirement it changes.

## Final process and artifact audit

Not yet run. Temporary screenshots and runtime data must not be committed.
