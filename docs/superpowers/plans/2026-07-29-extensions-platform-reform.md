# Extensions Platform Reform and Repository Extraction Plan

**Status:** Draft for review  
**Date:** 2026-07-29  
**Goal:** Replace Tower's compile-time extension collection with a versioned,
permission-aware platform. V1 uses logically isolated packages in the Tower
monorepo; physical repository extraction begins only after the contracts and
runtime have stabilized.

**Inputs:** [Requirements](../../specs/extensions-platform-requirements.md) · [Architecture](../../design/extensions-platform-architecture.md) · [Technical specification](../../specs/extensions-platform-spec.md)

## 1. Delivery strategy

The reform is contract-first and incremental:

```text
Inventory facade
    → v2 contracts and handlers
    → legacy adapters
    → package boundary enforcement
    → official extensions monorepo
    → independent Catalog release
    → legacy removal
```

Physical repository extraction is outside the V1 delivery scope. V1 is complete
only when each extraction candidate builds and passes contract tests without
importing Tower application code, making the later move mechanical.

No phase requires migrating all extension kinds at once. Catalog v1 CLI
Providers remain supported through the compatibility window.

## 2. Workstreams

| Workstream | Scope |
|---|---|
| Control plane | Inventory, Extension Manager, operation plans, registry |
| Contracts | Manifest v2, Catalog v2, SDK, package validator |
| Kind implementations | Component, CLI Provider adapter, gateway adapter |
| Product UX | Installed/Available/Developer, detail view, permissions |
| Repository extraction | External official extensions and Catalog CI |
| Operations | Compatibility, backup/restore, diagnostics, rollback |

## 3. Phase 0 — Review and architecture decisions

### Deliverables

- [ ] Review and approve the requirements, architecture, and specification.
- [ ] Decide whether SDK extraction occurs after one in-repo release cycle.
- [ ] Decide whether official Catalog source lives with official extensions.
- [ ] Select installed registry persistence: filesystem v3 or SQLite.
- [ ] Select Catalog v2 compatibility strategy:
  - parallel `index.v2.json`, or
  - backwards-compatible multi-version endpoint.
- [ ] Decide rollback retention: current + one previous version is recommended.
- [ ] Confirm that custom extension UI is excluded from v2.
- [ ] Confirm canonical IDs and legacy aliases.

### Exit criteria

- Major open decisions have owners and recorded outcomes.
- No unresolved decision changes the public manifest envelope or security model.

## 4. Phase 1 — Unified inventory facade

### Goal

Create one read model for the existing systems without changing their install
behavior.

### Tasks

- [x] Introduce `ExtensionInventoryItem`, source, state, lifecycle, diagnostic,
  and deployment DTOs.
- [x] Implement discovery adapters for:
  - legacy `src/lib/extensions` definitions;
  - Catalog v1 CLI Providers;
  - installed CLI plugin registry;
  - ripgrep system dependency;
  - Tower Agent gateway deployment checks.
- [x] Define ID aliases without changing stored legacy data.
- [ ] Implement conflict and duplicate-source diagnostics.
- [ ] Add cache invalidation events for install, configure, enable, disable,
  uninstall, and external dependency recheck.
- [ ] Expose a server-side inventory query used by the Settings page.
- [ ] Add contract tests covering every current extension state.

### Suggested module ownership

```text
packages/extension-core/
  inventory-types.ts
  discovery.ts
  errors.ts

src/lib/extensions/
  legacy-discovery-adapter.ts
  inventory-service.ts
```

The final package name is subject to review. It MUST NOT introduce a circular
dependency from a public SDK back to the Tower application.

### Exit criteria

- Extensions UI can render all current entries from one DTO source.
- Existing install and configuration actions behave unchanged.
- No new compile-time union is required to display a Catalog entry.

## 5. Phase 2 — UX information architecture

### Goal

Separate discovery, configuration, and deployment semantics while retaining one
Extensions product area.

### Tasks

- [ ] Replace current stacked sections with Installed, Available, and Developer
  views.
- [ ] Add capability filters: AI command line, Tower components, gateways and
  automation.
- [ ] Add source, trust, compatibility, version, and health badges.
- [ ] Add an extension detail route or drawer.
- [ ] Move provider connection forms to the extension detail surface while
  retaining AI capability-slot links.
- [ ] Present one `Tower Gateway Agent` with OpenClaw and Hermes deployment
  targets.
- [ ] Show ripgrep as a system capability with detection/install guidance, not
  as a Catalog package.
- [ ] Change onboarding so only low-risk components may be recommended and
  gateway/provider extensions are never selected by default.
- [ ] Preserve accessible keyboard and mobile behavior.
- [ ] Add visual and interaction regression tests.

### Exit criteria

- Users can distinguish installed package, enabled provider, and deployed
  gateway state.
- Complex gateway configuration no longer dominates the landing page.
- All existing extension operations remain reachable.

## 6. Phase 3 — v2 contracts and SDK seed

### Goal

Produce the contracts that an extension outside the Tower repository can use.

### Tasks

- [x] Implement strict runtime manifest v2 validation for each accepted kind.
- [ ] Implement Catalog v2 schema and parser with bounded reads.
- [ ] Define operation plan, effect, confirmation, and registry v3 schemas.
- [ ] Define canonical JSON and plan digest behavior.
- [ ] Implement package path, symlink, size, count, script, dependency, and
  package-tree validation.
- [ ] Create `@tower-org/extension-sdk` with:
  - manifest builders/types;
  - kind helpers;
  - validator CLI;
  - deterministic pack command;
  - test host and fixtures.
- [ ] Add API and SDK compatibility range evaluation.
- [ ] Publish an internal prerelease package from CI.
- [ ] Add clean-room CI that installs a packed SDK tarball into an empty
  temporary project and builds fixture extensions.

Completed foundation hardening:

- [x] Reject invalid SemVer, invalid compatibility-range syntax, duplicate
  permissions/capabilities, non-normalized package paths, unsafe mount IDs, and
  duplicate raw JSON keys.
- [x] Run Extension SDK build and contract tests in the main CI test job.

### Exit criteria

- Fixture packages validate and build without Tower source.
- Unknown manifest fields and unsupported kind/permission combinations fail.
- Identical source inputs produce the same package tree and artifact digests.

## 7. Phase 4 — Extension Manager and transactions

### Goal

Generalize the hardened CLI Provider control-plane lifecycle.

### Tasks

- [ ] Implement per-extension operation locking.
- [ ] Implement plan generation and digest-bound confirmation.
- [ ] Implement staging and atomic registration.
- [ ] Implement registry v3 or selected database model.
- [ ] Implement redacted operation journal and stable error codes.
- [ ] Implement prior-registration rollback.
- [ ] Add kind-handler dispatch with no package-supplied handlers.
- [ ] Adapt existing CLI Provider plan/confirm/enable flow rather than
  duplicating it.
- [ ] Make legacy server actions thin compatibility facades where practical.
- [ ] Add crash, stale-plan, corrupt-registry, concurrent-operation, and failed
  verification tests.

### Exit criteria

- An apply failure cannot leave executable extension code enabled.
- Permission additions require a fresh confirmation.
- The previous working registration survives failed update.

## 8. Phase 5 — Kind handler migrations

### 5A. CLI Provider

- [ ] Project Catalog v1 entries and plugin registry v2 records into v2
  inventory and operation DTOs.
- [ ] Keep existing provider manifest/export compatibility.
- [ ] Add optional native manifest v2 packaging.
- [ ] Verify Qwen Code using only public SDK/runtime contracts.
- [ ] Document the Catalog v1 support and deprecation window.

### 5B. Tower component

- [ ] Define host-supported component mount identifiers.
- [ ] Package Monaco assets deterministically.
- [ ] Stage versioned assets and atomically activate the selected version.
- [ ] Keep the existing Monaco install path as a migration fallback.
- [ ] Decide whether older asset versions are pruned after rollback retention.

### 5C. Gateway adapter

- [ ] Define gateway deployment descriptor and target state.
- [ ] Implement host-owned OpenClaw and Hermes drivers.
- [ ] Move profile resources out of installer code.
- [ ] Preserve user-owned model/provider fields and existing backup behavior.
- [ ] Require Tower ownership markers for update and removal.
- [ ] Model OpenClaw/Hermes as targets of `tower.gateway-agent`.
- [ ] Test install, update, failed merge, uninstall, user edits, and target
  coexistence.

### 5D. System dependency

- [ ] Move ripgrep into normalized system-capability discovery.
- [ ] Retain platform-specific install documentation and recheck.
- [ ] Remove it from distributable `ExtensionId` after consumers migrate.

### Exit criteria

- Each current extension/capability has an explicit kind or system dependency
  classification.
- No handler accepts arbitrary install commands from a package.

## 9. Phase 6 — Boundary enforcement

### Goal

Make physical extraction mechanical rather than architectural.

### Tasks

- [ ] Define public package exports for SDK and any runtime contract used by
  external extensions.
- [ ] Ban extension imports from:
  - Tower `src/`;
  - Next.js;
  - Prisma;
  - private workspace-only packages.
- [ ] Add dependency graph and source import CI checks.
- [ ] Build every extraction candidate from a temporary directory using
  published/packed dependencies.
- [ ] Move extension-owned translations, icons, help content, configuration
  schema, and tests into extension packages.
- [ ] Define compatibility fixtures owned by Tower so a removed extension still
  has host-side conformance coverage.
- [ ] Document local extension development and release.

### Exit criteria

- Qwen Code, Tower Gateway Agent resources, and Monaco build cleanly after their
  source directories are copied outside the repository.
- Tower tests do not rely on importing those source directories.

## 10. Post-V1 Phase 7 — Official extensions repository

### Goal

Move optional official extension implementation out of Tower.

This phase starts after at least one stable V1.x cycle and is not a V1
acceptance criterion.

### Recommended initial layout

```text
tower-official-extensions/
├── package.json
├── pnpm-workspace.yaml
├── extensions/
│   ├── qwen-code/
│   ├── tower-gateway-agent/
│   └── monaco/
├── catalog/
│   ├── sources/
│   └── schemas/
└── .github/workflows/
```

### Tasks

- [ ] Create repository governance, CODEOWNERS, release permissions, and
  security policy.
- [ ] Consume released `@tower-org/extension-sdk`; do not use Git workspace
  links to Tower.
- [ ] Move Qwen Code first as the reference executable extension.
- [ ] Move Tower Gateway Agent resources and deployment descriptor.
- [ ] Move Monaco artifact source/build.
- [ ] Establish per-extension versioning and changelogs.
- [ ] Generate immutable artifacts and Catalog index in CI.
- [ ] Publish to an authorized HTTPS host.
- [ ] Run Tower compatibility tests against the published candidate Catalog.
- [ ] Remove moved implementation source from Tower only after a released Tower
  version installs the external artifacts successfully.

### Exit criteria

- Tower core CI consumes fixtures or published candidates but does not build all
  official extension source.
- Each official extension can release without a Tower application release.
- Rollback can pin a previous Catalog release.

## 11. Phase 8 — Legacy cleanup and general availability

### Tasks

- [ ] Migrate legacy registrations and IDs idempotently.
- [ ] Remove compile-time `ExtensionId` after all UI and consumers use string
  IDs with runtime validation.
- [ ] Remove duplicated client/server metadata registry.
- [ ] Remove legacy Tower Agent extension definitions and direct installer
  actions.
- [ ] Remove the old Monaco package-copy path after one supported rollback
  release.
- [ ] Keep Catalog v1 reader for the announced compatibility window, then
  remove it in a major/minor release according to project policy.
- [ ] Update backup/restore, diagnostics, onboarding, docs, and release gate.
- [ ] Publish extension author documentation and sample packages.
- [ ] Run upgrade tests from every supported legacy registry format.

### Exit criteria

- No external extension source is required in the Tower package.
- The main repository contains only host platform code, compatibility fixtures,
  and deliberately builtin capabilities.
- Upgrade and rollback paths are documented and tested.

## 12. Testing strategy

### Contract tests

- manifest and Catalog strict parsing;
- kind/entrypoint/permission combinations;
- compatibility range selection;
- canonical plan digest;
- package traversal, symlink, lifecycle script, native module, and size limits.

### Transaction tests

- install, enable, disable, update, repair, remove;
- stale confirmation and changed permissions;
- concurrent operation lock;
- network interruption and corrupt download;
- verification failure and rollback;
- registry corruption and recovery.

### Kind tests

- CLI Provider adapter compatibility and dependency probes;
- Monaco asset activation and rollback;
- gateway user-field preservation and ownership-marker enforcement;
- ripgrep external install/recheck behavior.

### Integration tests

- Catalog v1 and v2 coexistence;
- clean Tower install with no optional extension;
- legacy upgrade with existing registry and gateway profiles;
- external official Catalog install;
- backup and restore into a newer Tower version.

### UX tests

- source/trust/permission display;
- installed versus enabled versus deployed state;
- plan confirmation;
- mobile and keyboard navigation;
- error recovery and developer diagnostics.

## 13. Release and compatibility policy

Recommended rollout:

1. Release inventory facade and new UI with no storage migration.
2. Release v2 SDK as prerelease and run official extensions in dual-build CI.
3. Release Extension Manager with legacy adapters.
4. Publish official external extension candidates.
5. Make external Catalog artifacts the default source while keeping bundled
   fallback for one release.
6. Remove bundled implementations after telemetry/manual acceptance confirms
   the external path.

Every phase MUST have an off switch or fallback that does not delete user
configuration.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Public SDK freezes unstable internals | Begin with narrow use cases and prerelease versions |
| Multi-repo changes become coordinated releases | SemVer compatibility ranges and contract fixtures |
| Generic manifests expand into arbitrary execution | Closed kinds and host-owned handlers |
| Catalog compromise | Integrity checks, trust policy, later signing/revocation |
| Gateway uninstall deletes user edits | Ownership markers, field-level merge, backups |
| UI hides distinct lifecycle states | Explicit installed/enabled/deployed vocabulary |
| Migration breaks existing providers | Catalog v1 and plugin registry v2 adapters |
| Too many repositories | Start with one official extensions monorepo |

## 15. Suggested review order

Reviewers should read:

1. requirements: product boundary and scope;
2. architecture: host/extension ownership and security;
3. technical specification: protocol commitments;
4. this plan: sequencing and repository extraction.

The review should focus first on the decisions in Phase 0. Naming and file
placement can change later; extension kinds, execution boundaries, permission
model, and compatibility strategy are costly to change after external packages
ship.
