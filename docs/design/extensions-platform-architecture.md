# Tower Extensions Platform — Architecture Design

**Status:** Draft for review  
**Date:** 2026-07-29  
**Related:** [Requirements](../specs/extensions-platform-requirements.md) · [Technical specification](../specs/extensions-platform-spec.md) · [Migration plan](../superpowers/plans/2026-07-29-extensions-platform-reform.md)

## 1. Decision

Tower will unify extension discovery, state, planning, permission review, and
operations while keeping execution strategies separated by extension kind.

The platform is designed for external packages from the beginning, but V1 keeps
them as isolated workspaces in the Tower monorepo. The host owns the boundary
and handlers; extension packages own declarative manifests and kind-specific
implementations. Moving those packages to another repository is a later
delivery operation, not a V1 architectural dependency.

This is not a universal plugin runner. A `cli-provider`, a static Monaco asset
package, and an OpenClaw profile deployment do not share the same mutation or
execution semantics.

## 2. Context

Tower currently has:

- a compile-time registry under `src/lib/extensions`;
- client-safe metadata duplicated from server definitions;
- a Catalog v1 restricted to `cli-provider`;
- a hardened CLI plugin plan, registry, and runtime under `packages/ai-runtime`;
- gateway-specific Tower Agent installers exposed through the compile-time
  registry.

The CLI Provider system already contains useful platform primitives: bounded
Catalog reads, HTTPS enforcement, artifact hashes, install plans, permission
diffs, digest-bound confirmation, registry recovery, and disabled-before-review
behavior. The reform generalizes those control-plane concepts without forcing
all extension kinds through the CLI Provider loader.

## 3. Architectural principles

1. **Core owns authority.** Extensions request capabilities; Tower decides and
   enforces what is allowed.
2. **Manifest is data.** It is serializable, strictly validated, and contains no
   imported React components or host functions.
3. **Kinds are closed contracts.** Each kind has its own schema, handler, and
   permission allowlist.
4. **Plan before mutation.** Confirmation binds to the exact reviewed plan.
5. **Install is not enable.** Executable code is disabled until validation,
   permission confirmation, configuration, and health checks pass.
6. **Host APIs are stable DTOs.** Extensions do not import Tower internals.
7. **External by construction.** CI verifies that official extension packages
   can build without the Tower application source tree.
8. **Compatibility over flag days.** Catalog v1 and legacy builtin extensions
   are adapted into the new inventory during migration.

## 4. System overview

Editable source and rendered preview:
[Extensions Platform V1 diagram](../diagrams/extensions-platform-v1.drawio) ·
[PNG preview](../diagrams/extensions-platform-v1.drawio.png)

```text
 Builtin definitions     Catalog indexes       Local development
          │                     │                       │
          └──────────────┬──────┴───────────────────────┘
                         ▼
              Extension Discovery Service
                         │
                         ▼
               Normalized Inventory Store
                         │
              inspect / plan / state / events
                         ▼
                 Extension Manager
                ┌────────┼───────────┐
                ▼        ▼           ▼
          Component   CLI Provider  Gateway Adapter
           Handler      Handler        Handler
                │        │           │
                ▼        ▼           ▼
          Static data  AI Runtime  Managed gateway
          / host deps  + Host API  files/adapters
```

The Extension Manager is the only application service used by the Extensions
UI. Handlers are host code selected by `kind`; a package cannot supply or
replace its handler.

## 5. Components

### 5.1 Extension Discovery Service

Reads:

- builtin descriptors shipped with Tower;
- configured Catalog indexes;
- the installed extension registry;
- local development registrations;
- host-defined system dependency probes.

It validates each source independently and produces inventory candidates.
Discovery never imports extension executable code.

### 5.2 Normalized Inventory Store

Merges candidates into `ExtensionInventoryItem` records. It preserves both
available and installed versions and reports conflicts rather than silently
choosing an arbitrary package.

Suggested precedence for the same `(id, version)`:

1. installed registration for current operational state;
2. builtin definition for Tower-owned capability state;
3. configured official Catalog for updates;
4. local development only when explicitly selected.

Local development registrations use a separate source identity and never
silently shadow Catalog installations.

The first implementation may calculate inventory on demand and cache it.
Persistent database storage is not required until administration or audit
requirements justify it.

### 5.3 Extension Manager

Exposes a kind-neutral application API:

```ts
interface ExtensionManager {
  list(query?: ExtensionQuery): Promise<ExtensionInventoryItem[]>;
  get(ref: ExtensionRef): Promise<ExtensionInventoryItem>;
  plan(request: ExtensionOperationRequest): Promise<ExtensionOperationPlan>;
  apply(plan: ExtensionOperationPlan, confirmation: PlanConfirmation): Promise<OperationResult>;
  configure(ref: InstalledExtensionRef, values: unknown): Promise<OperationResult>;
  enable(ref: InstalledExtensionRef): Promise<OperationResult>;
  disable(ref: InstalledExtensionRef): Promise<OperationResult>;
  diagnose(ref: ExtensionRef): Promise<ExtensionDiagnostic[]>;
}
```

The manager performs common validation, locks operations per extension,
persists operation state, dispatches to the handler, verifies the result, and
updates the registry.

### 5.4 Kind handlers

Handlers are host-owned adapters:

```ts
interface ExtensionKindHandler<K extends ExtensionKind> {
  readonly kind: K;
  validateManifest(manifest: ManifestFor<K>): void;
  inspect(candidate: ExtensionCandidate<K>): Promise<KindInspection>;
  plan(request: KindOperationRequest<K>): Promise<KindOperationPlan<K>>;
  apply(plan: KindOperationPlan<K>, context: ApplyContext): Promise<ApplyResult>;
  verify(ref: InstalledExtensionRef<K>): Promise<ExtensionDiagnostic[]>;
}
```

#### Tower component handler

Manages Tower-owned static assets or bounded host capabilities. It may copy
verified files into a versioned directory and atomically switch an active
pointer. It does not execute package lifecycle scripts.

Monaco is the first candidate. ripgrep remains a system dependency probe unless
Tower later publishes a platform-specific signed binary bundle.

#### CLI Provider handler

Adapts the current `packages/ai-runtime` plugin runtime. Existing manifest v1,
config schema, permissions, dependency probes, and provider connection logic
remain valid. Catalog v1 entries are projected into the v2 inventory.

The loader continues to accept only the documented provider export and rejects
source-time workspace imports, lifecycle scripts, native modules, and escaping
paths.

#### Gateway adapter handler

Applies declarative resources to supported gateways through a host-owned gateway
driver. The extension package supplies Tower profile resources and a deployment
descriptor; the host driver owns filesystem paths, merging, backup, markers,
and gateway-specific validation.

The package cannot run arbitrary filesystem code. OpenClaw and Hermes are
deployment targets of one logical `Tower Gateway Agent` extension:

```text
Tower Gateway Agent
├── OpenClaw deployment: installed / configured / healthy
└── Hermes deployment: not installed
```

### 5.5 Host API

Executable kinds communicate through a versioned Host API:

```ts
interface TowerExtensionHostV1 {
  readonly extension: {
    id: string;
    version: string;
  };
  readonly logger: ExtensionLogger;
  readonly secrets: ScopedSecretApi;
  readonly workspace: ScopedWorkspaceApi;
}
```

The actual API surface starts smaller than this example and grows only from
approved use cases. Each method:

- accepts and returns serializable stable DTOs;
- checks a declared permission;
- scopes access to the active workspace/project where applicable;
- redacts secrets and sensitive paths from logs;
- is mockable by the SDK test harness.

No extension imports Prisma, Next.js actions, React components, PTY internals,
or private Tower packages.

CLI Providers may initially keep their current adapter surface. They migrate to
Host API methods only where a real provider requirement exists.

### 5.6 Extension SDK

`@tower-org/extension-sdk` contains:

- manifest TypeScript types and JSON Schemas;
- Host API contracts;
- helpers for each supported kind;
- a manifest and package validator;
- a test host with permission assertions;
- a packaging CLI that produces deterministic artifacts;
- compatibility metadata and deprecation notices.

It must not depend on the Tower application package. The SDK is semantically
versioned independently from Tower.

### 5.7 Catalog

Catalog indexes are immutable descriptions of published releases, not a code
execution service. They include artifact URL, SHA-256, byte size, publisher,
kind, compatibility, and release metadata.

The official source repository and publication host may be separate. Tower
supports configured Catalog URLs, but the initial product may expose only one
official URL.

Catalog v2 uses a discriminated kind schema. It does not add a generic
`installScript`, `postInstall`, or arbitrary command field.

### 5.8 Registry and operation journal

The installed registry records:

- exact extension identity and version;
- source and artifact integrity;
- validated manifest digest;
- confirmed permissions and plan digest;
- installation location or managed deployment targets;
- enabled state;
- installed and updated timestamps;
- last known health;
- previous registration needed for rollback.

A small append-only operation journal records plan, transition, and outcome
without secret values. A filesystem registry remains acceptable initially, but
writes must be atomic and recovery-tested.

## 6. Package and repository architecture

### 6.1 V1 monorepo layout

```text
tower/
├── packages/extension-sdk/
├── packages/extension-core/
├── extensions/
│   ├── cli-providers/
│   ├── gateway-adapters/
│   └── components/
└── src/
    └── host application and kind handlers
```

Workspace location grants no additional authority. Extensions obey the same
public-import and clean-room-build rules they will have after extraction.

### 6.2 Post-stabilization target ownership

```text
tower
├── Extension Manager
├── discovery and inventory
├── kind handlers
├── permission enforcement
├── installed registry
├── Extensions UI
└── compatibility adapters

tower-extension-sdk
├── contracts
├── schemas
├── validator
├── packager
└── test harness

tower-official-extensions
├── extensions/qwen-code
├── extensions/tower-gateway-agent
├── extensions/monaco
└── catalog/sources
```

The official extensions repository begins as a monorepo. Individual extensions
can move to their own repositories later without changing the package or
Catalog protocol.

### 6.3 Dependency rule

An external extension build graph must not contain:

- the Tower application package;
- `src/` paths from Tower;
- Next.js;
- Prisma client or schema;
- private workspace packages not included in the public SDK contract.

CI builds an extension from a packed SDK artifact in a clean temporary
workspace to enforce the rule.

## 7. Installation transaction

```text
1. Resolve source and version
2. Fetch bounded artifact
3. Verify hash and package structure
4. Validate manifest and compatibility
5. Inspect dependency state
6. Produce deterministic plan and digest
7. Obtain user confirmation
8. Acquire per-extension operation lock
9. Stage files in a temporary version directory
10. Revalidate digest and permissions
11. Apply through the host-owned kind handler
12. Verify health
13. Atomically commit registry/active pointer
14. Keep or restore previous registration
15. Record redacted operation outcome
```

Cancellation or failure before step 13 removes staged data. Failure after an
external gateway mutation invokes the handler's compensating rollback where
safe; otherwise the deployment remains disabled and presents repair guidance.

## 8. Security model

### 8.1 Threats

- malicious or compromised Catalog;
- artifact replacement;
- path traversal or symlink escape;
- manifest/parser confusion;
- permission expansion during update;
- secret leakage through configuration or logs;
- arbitrary install scripts;
- extension code importing host internals;
- gateway installer overwriting user-owned configuration;
- local development package impersonating an official extension.

### 8.2 Controls

- HTTPS and configurable trusted Catalogs;
- exact SHA-256 and byte-size verification;
- strict schemas with unknown-field rejection;
- bounded reads and extraction;
- normalized-path and symlink checks;
- no package lifecycle scripts;
- kind-specific entrypoint and permission allowlists;
- digest-bound permission confirmation;
- disabled-before-enable execution state;
- scoped secret handles rather than raw Catalog values;
- Tower ownership markers for managed external files;
- publisher signing and revocation as a later hardening phase.

Integrity proves artifact consistency, not publisher identity. The UI must not
label a hash-verified unknown publisher as verified.

## 9. UI architecture

The UI consumes only inventory and operation DTOs. It does not import package
metadata or kind implementations.

```text
/settings/extensions
  Installed | Available | Developer

/settings/extensions/:extensionId
  Overview
  Permissions
  Configuration
  Diagnostics
  Versions
  Deployments (gateway-adapter only)
```

Settings use host-rendered JSON Schema controls. Extension content may include
sanitized Markdown documentation and image assets. Custom executable UI is
outside v2.

## 10. Compatibility strategy

### Catalog v1

The host continues to read Catalog v1 CLI Provider indexes. An adapter maps
their entries to normalized v2 inventory DTOs. Existing registry v2 records
remain authoritative for installed providers.

### Legacy builtin registry

`rg`, `monaco`, and Tower Agent definitions receive compatibility adapters.
During migration, legacy server actions delegate to Extension Manager or remain
as thin facades. Once all consumers use the normalized inventory and the data
has migrated, compile-time `ExtensionId` is removed.

### Extension IDs

IDs are stable lowercase publisher-qualified identifiers. Proposed mappings:

| Legacy ID | Proposed ID |
|---|---|
| `monaco` | `tower.monaco` |
| `tower-agent-openclaw` | `tower.gateway-agent` deployment `openclaw` |
| `tower-agent-hermes` | `tower.gateway-agent` deployment `hermes` |
| `community.qwen-code` | unchanged |

`rg` becomes system capability `system.ripgrep`, not an installed extension.

Alias migration must be explicit and one-way. IDs are never silently reused.

## 11. Alternatives considered

### Put every extension into the existing CLI Provider runtime

Rejected. Static assets, system dependencies, and gateway deployments have
different security and rollback semantics.

### Move directories to separate repositories first

Rejected as the first step. Without a stable SDK and import boundary, this
replaces local imports with brittle package coupling and makes coordinated
changes harder.

### Allow arbitrary package scripts

Rejected. It destroys the usefulness of typed kinds, permission review, and
predictable rollback.

### Keep all official extensions in Tower forever

Rejected. It couples core releases and CI to optional dependencies and prevents
independent ownership and release cadence.

### One repository per extension immediately

Deferred. An official extensions monorepo provides independent packages and
releases without multiplying repository administration before contracts
stabilize.

## 12. Consequences

Positive:

- extensions can leave the Tower repository;
- core release cadence is isolated from optional providers and gateway assets;
- users receive a consistent lifecycle and permission experience;
- new kinds require explicit host and security design;
- legacy CLI Provider hardening is reused.

Costs:

- the host maintains kind handlers and compatibility adapters;
- SDK compatibility becomes a public commitment;
- multi-repository CI and release automation are required;
- gateway deployment rollback needs careful ownership tracking;
- UI and service code must migrate away from compile-time IDs.

## 13. Open architecture decisions

1. Filesystem registry versus SQLite operation/installation tables.
2. Publisher signing format, key rotation, and revocation delivery.
3. Exact initial Host API surface for executable providers.
4. Whether component artifacts are served from immutable version paths or
   copied into Tower's current static asset location.
5. Whether Catalog v2 is a new index alongside v1 or a backwards-compatible
   envelope containing v1 provider entries.
