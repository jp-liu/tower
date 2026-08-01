# Tower Extensions Platform Reform — Product Requirements

**Status:** Draft for review  
**Date:** 2026-07-29  
**Owners:** Tower maintainers  
**Related:** [Architecture](../design/extensions-platform-architecture.md) · [Technical specification](./extensions-platform-spec.md) · [Migration plan](../superpowers/plans/2026-07-29-extensions-platform-reform.md)

## 1. Summary

Reform Tower Extensions into a capability distribution and permission-control
platform. V1 keeps extension source in the Tower monorepo while enforcing the
same package, build, and runtime boundaries required for later extraction.

The reform must let Tower move official extensions out of the main repository
after the contracts have stabilized, without replacing the current CLI Provider
runtime all at once. Tower remains the host and trust boundary; extension
packages provide narrowly defined capabilities through versioned contracts.

## 2. Problem

The current Extensions page combines three systems with different semantics:

| Current area | Examples | Current mechanism |
|---|---|---|
| Optional Tower components | ripgrep, Monaco | Compile-time registry and server actions |
| CLI Providers | Qwen Code | Catalog, manifest, install plan, permission confirmation, runtime registry |
| Gateway Agent installers | OpenClaw, Hermes | Compile-time registry plus gateway-specific filesystem mutation |

This causes the following problems:

1. `ExtensionId` and client metadata are compiled into Tower, so adding an
   extension normally changes and releases the host.
2. Installation, configuration, enablement, and deployment are presented as if
   they were one operation.
3. Official extension source, fixtures, catalog generation, SDK code, and the
   host application are maintained in one repository.
4. Tower Agent targets are modeled as two extensions even though they provide
   one Tower capability deployed to different gateways.
5. The old registry and the newer CLI Provider Catalog expose different status,
   error, and lifecycle models.
6. A future generic plugin format could accidentally grant arbitrary install
   scripts or direct access to Tower internals.

## 3. Product goal

Make Extensions the place where users can discover, inspect, install,
configure, enable, diagnose, update, and remove optional Tower capabilities,
regardless of where their source repository lives.

An extension should be independently releasable when its kind supports external
packaging. Installing or updating an extension should not require releasing or
restarting Tower unless the declared compatibility contract says otherwise.

## 4. Non-goals

The first reform does not:

- provide arbitrary third-party React components inside Tower;
- allow arbitrary lifecycle shell scripts;
- guarantee operating-system sandboxing for extension JavaScript;
- migrate every current extension out of the repository immediately;
- turn every optional dependency into an executable plugin;
- operate or restart third-party gateways automatically;
- create a public community marketplace before signing, review, and revocation
  policies exist;
- replace the existing CLI Provider adapter contract in one release.

## 5. Users

### Tower user

Wants to understand what a capability does, where it came from, what it can
access, whether it is healthy, and how to reverse installation.

### Tower administrator

Wants to restrict extension sources, publishers, versions, kinds, and
permissions, and to audit installed extension state.

### Extension developer

Wants a stable SDK, local development workflow, package validator, test
harness, and a release format independent of Tower's source tree.

### Tower maintainer

Wants the core repository and release train isolated from optional extension
implementation and dependency churn.

## 6. Product model

### 6.1 Extension kinds

The initial platform recognizes three user-facing kinds:

| Kind | Purpose | Initial examples |
|---|---|---|
| `tower-component` | Optional Tower-owned assets or host capabilities | Monaco |
| `cli-provider` | Connect an AI CLI to Tower's provider runtime | Qwen Code |
| `gateway-adapter` | Deploy Tower capability into a supported external gateway | Tower Gateway Agent targeting OpenClaw or Hermes |

`system-dependency` is an inventory state, not a distributable extension kind.
ripgrep should be detected and explained by Extensions, but Tower must not
misrepresent a PATH dependency as a downloadable JavaScript plugin.

`tool-provider` and `agent-provider` are reserved product ideas, not v2 schema
values. They require separate use cases and security contracts before adoption.

### 6.2 Source and trust

Every extension shows:

- source: `builtin`, `official-catalog`, or `local-development`;
- publisher identity;
- trust: `tower`, `verified`, or `unverified`;
- installed and available versions;
- declared permissions;
- compatibility with the running Tower version;
- whether its code executes in Tower, manages static assets, or writes to an
  external gateway profile.

Trust labels describe provenance; they do not bypass permission confirmation.

### 6.3 Lifecycle

The common lifecycle is:

```text
Discover → Inspect → Plan → Confirm → Apply → Verify
                                      ↓
                         Configure / Enable / Disable
                                      ↓
                            Update / Repair / Remove
```

Not every kind implements every operation. Unsupported operations are declared
in metadata and omitted from the UI.

Installation and enablement are distinct. A newly installed executable
extension remains disabled until its requested permissions are confirmed and
its health check succeeds.

## 7. Functional requirements

### FR-1 Unified inventory

Tower must expose one normalized inventory containing builtin definitions,
Catalog entries, installed packages, system dependencies, and local development
registrations. Duplicate IDs are resolved by explicit source precedence and
reported as diagnostics.

### FR-2 Data-driven discovery

Externally packaged extensions must be discoverable without adding their IDs,
icons, translations, or settings fields to Tower source code.

### FR-3 Typed kind contracts

Each extension kind must have a closed manifest schema and a host-owned handler.
An extension cannot add undeclared entrypoints or request permissions outside
the allowlist for its kind.

### FR-4 Installation plan

Before a mutating operation Tower must show a deterministic plan containing:

- operation and target version;
- publisher, source, integrity, and compatibility;
- added and removed permissions;
- files or managed targets affected at an appropriate abstraction level;
- external dependencies and detected versions;
- whether executable code will be loaded;
- rollback or uninstall availability.

The confirmation must bind to a digest of the reviewed plan.

### FR-5 Integrity and compatibility

Catalog artifacts must be fetched over HTTPS, size-limited, hash-verified, and
validated before registration. Manifests declare supported Tower and Extension
SDK version ranges. Incompatible packages cannot be enabled.

### FR-6 Permissions

Permissions must be capability-based, reviewable, kind-scoped, and deny by
default. Permission additions during update require new confirmation. Secret
values must not be stored in manifests, plans, logs, or Catalog indexes.

### FR-7 Configuration

Extensions may provide a bounded JSON Schema for host-rendered settings.
Sensitive fields are stored through Tower's secret storage. The initial
platform does not load extension-provided React settings components.

### FR-8 Operations and diagnostics

Every installed entry exposes normalized state and health:

- installation state;
- enabled state where applicable;
- compatibility state;
- dependency diagnostics;
- last operation outcome;
- update availability;
- repair or recovery action when supported.

### FR-9 Rollback and removal

Failed apply operations must not leave an enabled partial registration. Tower
must preserve enough previous registration data to restore or disable the prior
version. External gateway files are removed only when Tower can prove ownership
through managed markers; user-owned fields are preserved.

### FR-10 Local development

Developers can validate and register a local package without publishing it.
Local development entries are visibly unverified, disabled by default, and
cannot silently replace an installed Catalog extension.

### FR-11 Extraction-ready build

An official extension can be built, tested, versioned, and packaged from its
monorepo workspace without importing Tower application source. Moving that
workspace to another repository later must not require a manifest, runtime, or
Host API redesign.

### FR-12 Administration

The design must permit a later administrator policy to allow or deny Catalog
URLs, publishers, extension IDs, kinds, version ranges, and permissions. The
initial release may ship only a single configured official Catalog.

### FR-13 Backup and restore

Backup records installed registrations, configuration references, and managed
extension data without treating downloaded artifacts as irreplaceable user
data. Restore revalidates compatibility and integrity before enabling restored
extensions.

### FR-14 Onboarding

Onboarding may recommend low-risk Tower components. It must not default-select
gateway deployments or executable third-party providers. Skipping onboarding
must leave Tower functional.

## 8. UX requirements

The Extensions landing page contains:

1. **Installed** — installed extensions and detected system capabilities;
2. **Available** — compatible Catalog entries;
3. **Developer** — local registration and diagnostics.

Filters describe capabilities rather than implementation:

- AI command line;
- Tower components;
- gateways and automation.

An extension card shows identity, source, trust, version, state, capability
summary, and one primary action. Complex gateway or provider configuration
opens a detail route or drawer instead of permanently expanding on the landing
page.

The logical `Tower Gateway Agent` appears once. OpenClaw and Hermes are install
targets within its detail view and may have independent deployment state.

## 9. Repository and distribution requirements

The V1 source layout remains in the Tower monorepo:

```text
tower
  packages/extension-sdk
  packages/extension-core
  extensions/<kind>/<extension>
  src/... host application and kind handlers
```

The target post-stabilization repository layout is:

```text
tower
  Host application, Extension Manager, handlers, permission enforcement

tower-extension-sdk
  Manifest types, Host API contracts, validators, test harness, packaging CLI

tower-official-extensions
  Initial official extension monorepo with independently versioned packages

extension-catalog
  Reviewable release metadata and generated immutable indexes/artifacts
```

The SDK, Catalog tools, and official extensions begin as workspace packages in
`tower` while their public contracts stabilize. Physical repository extraction
is explicitly outside the V1 acceptance gate and follows contract enforcement,
not the other way around.

An external extension may depend on `@tower-org/extension-sdk` and explicitly
approved third-party packages. It must not import Tower application source,
Next.js server actions, Prisma models, or private workspace packages.

## 10. Success criteria

The reform is successful when:

1. Qwen Code can be clean-room built from its workspace using only published or
   packed public contracts and installed from a Catalog without host source
   imports.
2. At least one gateway adapter can be migrated without direct imports from
   Tower application code.
3. The landing page presents all current capability states through one
   normalized inventory API.
4. Permission additions on update require a new digest-bound confirmation.
5. A failed install or update leaves no enabled partial extension.
6. Tower core and extension CI jobs are separated so extension failures do not
   obscure core test ownership, even though they still run in one repository.
7. Existing Catalog v1 CLI Provider installations remain usable during the
   migration window.

## 11. Open product decisions

1. Should `tower-extension-sdk` become a separate repository immediately after
   contract stabilization, or remain a separately published package in Tower
   for one release cycle?
2. Should the official Catalog and official extension source share one
   repository?
3. Is rollback to exactly one previous version sufficient, or must Tower retain
   multiple installed artifacts?
4. Should administrators be able to hide local development mode entirely?
5. When, if ever, should Tower support custom extension UI?
