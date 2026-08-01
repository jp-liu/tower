# Tower Extensions Platform v2 — Technical Specification

**Status:** Draft for review  
**Date:** 2026-07-29  
**Normative language:** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY  
**Related:** [Requirements](./extensions-platform-requirements.md) · [Architecture](../design/extensions-platform-architecture.md) · [Migration plan](../superpowers/plans/2026-07-29-extensions-platform-reform.md)

## 1. Scope

This specification defines:

- extension identity and kinds;
- package manifest v2;
- Catalog index v2;
- normalized inventory and state;
- operation plans and confirmation;
- installed registration;
- kind-specific entrypoints;
- configuration and permissions;
- compatibility and package validation.

It does not standardize a custom extension UI or a public marketplace review
process.

## 2. Identity

An extension ID MUST:

- be 1–128 characters;
- use lowercase ASCII letters and digits;
- allow `.`, `_`, and `-` only as non-repeating separators;
- be stable across repository, package, and publisher changes;
- be publisher-qualified unless reserved for Tower.

Valid examples:

```text
tower.monaco
tower.gateway-agent
community.qwen-code
```

A deployment target is not part of the extension ID. For example, OpenClaw and
Hermes are target IDs of `tower.gateway-agent`.

Versions MUST be exact valid SemVer values in manifests and Catalog releases.

## 3. Extension kinds

```ts
type ExtensionKind =
  | "tower-component"
  | "cli-provider"
  | "gateway-adapter";
```

Unknown kinds MUST be rejected by v2 readers. New kinds require a new schema
revision or an explicitly compatible protocol revision.

## 4. Manifest v2

### 4.1 Common envelope

```ts
interface ExtensionManifestV2 {
  manifestVersion: 2;
  id: string;
  version: string;
  kind: ExtensionKind;
  apiVersion: string;
  engines: {
    tower: string;
    extensionSdk: string;
  };
  display: {
    name: string;
    description: string;
    homepage?: string;
    icon?: string;
  };
  capabilities: string[];
  permissions: ExtensionPermission[];
  configuration?: {
    schema: string;
  };
  entrypoints: ExtensionEntrypoints;
}
```

The on-disk manifest filename MUST be `tower-extension.json`.

The manifest MUST be UTF-8 JSON, MUST reject duplicate keys, and MUST reject
unknown fields. URLs MUST be HTTPS except documented localhost development
values. Paths MUST be package-relative normalized POSIX paths.
Hosts reading an on-disk manifest MUST use the raw-text parser
`parseExtensionManifestJson`; parsing with `JSON.parse` before validation loses
the information needed to reject duplicate keys.

`display.icon` MAY reference a package-relative SVG or PNG. SVG content MUST be
sanitized by the host and MUST NOT contain scripts, external references, event
handlers, or foreign objects.

`configuration.schema` MAY reference a package-relative JSON Schema file.

### 4.2 Entrypoint discriminators

#### `tower-component`

```ts
interface ComponentEntrypoints {
  assets: string;
  activation: {
    type: "static-assets";
    mount: string;
  };
}
```

The handler copies verified assets. It MUST NOT execute package JavaScript.
`mount` is selected from host-supported component mount identifiers; it is not
an arbitrary filesystem path.

#### `cli-provider`

During the compatibility period, a CLI Provider MAY use the existing manifest
v1 and `./tower-cli-provider` package export. Native v2 packages use:

```ts
interface CliProviderEntrypoints {
  provider: string;
  configSchema: string;
}
```

The provider entry MUST conform to the published CLI Provider adapter contract.
The package MUST NOT contain lifecycle scripts, native modules, or unresolved
workspace dependencies.

#### `gateway-adapter`

```ts
interface GatewayAdapterEntrypoints {
  resources: string;
  deployment: string;
}

interface GatewayDeploymentDescriptor {
  schemaVersion: 1;
  targets: Array<{
    id: string;
    driver: "openclaw-profile" | "hermes-profile";
    resources: string[];
    requiredCapabilities: string[];
  }>;
}
```

`driver` selects host-owned code. The descriptor MUST NOT contain commands,
absolute paths, arbitrary templates with executable expressions, or hook
scripts.

## 5. Permissions

Permissions are string capabilities interpreted by the host. Initial namespace:

```ts
type ExtensionPermission =
  | "process:cli"
  | "config:read"
  | "config:write"
  | "secrets:read-scoped"
  | "workspace:read"
  | "gateway:openclaw-profile"
  | "gateway:hermes-profile";
```

The final allowlist for each kind is:

| Kind | Allowed namespaces |
|---|---|
| `tower-component` | none in v2 |
| `cli-provider` | `process:cli`, configuration, scoped secrets, explicitly approved workspace access |
| `gateway-adapter` | target-specific `gateway:*` permissions |

A package requesting a permission not allowed for its kind MUST fail
validation. Permission additions during update MUST produce a new confirmation.
Removed permissions SHOULD be shown but do not require confirmation.

Permission confirmation:

```ts
interface PlanConfirmation {
  planDigest: string;
  confirmedPermissions: ExtensionPermission[];
  confirmedAt: string;
}
```

The host MUST revalidate the plan digest immediately before apply.

## 6. Configuration schema

Tower supports a strict subset of JSON Schema:

- object roots;
- string, number, integer, boolean, and arrays of scalar values;
- enum;
- required;
- title, description, default;
- Tower-owned `x-tower` presentation annotations.

The schema MUST NOT contain executable expressions, remote references, or
extension-provided components. External `$ref` is forbidden. Package-local
references MAY be added in a later revision.

Sensitive values are indicated with:

```json
{
  "type": "string",
  "x-tower": {
    "sensitive": true
  }
}
```

Sensitive values MUST be stored separately from the installed registry and
MUST be masked in read APIs.

## 7. Catalog index v2

```ts
interface ExtensionCatalogIndexV2 {
  schemaVersion: 2;
  catalog: {
    id: string;
    generatedAt: string;
  };
  extensions: CatalogExtensionV2[];
}

interface CatalogExtensionV2 {
  id: string;
  kind: ExtensionKind;
  publisher: {
    id: string;
    name: string;
    verification: "tower" | "verified" | "unverified";
  };
  display: {
    name: string;
    description?: string;
    homepage?: string;
    icon?: CatalogAsset;
  };
  releases: Array<{
    version: string;
    engines: {
      tower: string;
      extensionSdk: string;
    };
    artifact: {
      url: string;
      sha256: string;
      size: number;
    };
    publishedAt: string;
    yanked?: boolean;
  }>;
}
```

Catalog readers MUST:

- limit index and artifact bytes;
- require HTTPS;
- reject redirects to non-HTTPS URLs;
- reject unknown fields;
- reject duplicate extension IDs and versions;
- reject invalid SemVer and compatibility ranges;
- select only non-yanked compatible releases by default.

`verification` is accepted only from a Catalog source whose trust policy allows
that publisher assertion. An untrusted Catalog cannot make itself official by
setting the field to `tower`.

Catalog v1 remains readable for `cli-provider` during the migration period.

## 8. Package format

An artifact is a deterministic compressed archive with:

```text
package/
├── tower-extension.json
├── package.json              # only when required by executable kinds
├── dist/
├── assets/
└── schemas/
```

Exact archive format is an implementation decision before the external SDK
release. Whichever format is selected:

- extraction MUST reject absolute paths, `..`, symlink escape, hardlink escape,
  device files, and case-collision ambiguity;
- total extracted bytes and file count MUST be bounded;
- package lifecycle scripts MUST be absent;
- executable package dependencies MUST be fully bundled or explicitly allowed
  by the kind contract;
- the package tree digest MUST cover normalized relative paths and file bytes.

## 9. Normalized inventory

```ts
interface ExtensionInventoryItem {
  id: string;
  kind: ExtensionKind | "system-dependency";
  display: ExtensionDisplay;
  source: {
    type: "builtin" | "official-catalog" | "catalog" | "package-registry" | "local-development" | "system";
    catalogId?: string;
    publisherId?: string;
    trust: "tower" | "verified" | "unverified";
  };
  installed: null | {
    version: string;
    enabled: boolean;
    installedAt: string;
  };
  available: null | {
    version: string;
  };
  compatibility: "compatible" | "incompatible" | "unknown";
  health: "ready" | "degraded" | "error" | "unknown";
  capabilities: string[];
  permissions: string[];
  lifecycle: {
    install: boolean;
    configure: boolean;
    enable: boolean;
    disable: boolean;
    update: boolean;
    repair: boolean;
    remove: boolean;
  };
  deployments?: ExtensionDeploymentState[];
  diagnostics: ExtensionDiagnostic[];
}
```

Inventory APIs MUST return safe display DTOs only. They MUST NOT expose secret
values, internal absolute paths unless required for explicit developer
diagnostics, or executable module objects.

Builtin inventory entries MAY carry host translation keys in addition to their
fallback display strings. Catalog v1 display data has no authenticated
publisher identity or localization contract and MUST remain `unverified`;
artifact integrity alone does not upgrade publisher trust.

CLI Provider registrations migrated from registry schema v1 may retain the
storage source value `legacy`. That value identifies the old persistence
format, not Tower provenance, and MUST be projected as
`package-registry` / `unverified`.

## 10. Operation plans

```ts
type ExtensionOperation =
  | "install"
  | "update"
  | "repair"
  | "remove"
  | "deploy"
  | "undeploy";

interface ExtensionOperationPlan {
  schemaVersion: 1;
  operation: ExtensionOperation;
  extension: {
    id: string;
    kind: ExtensionKind;
    fromVersion: string | null;
    toVersion: string | null;
  };
  source: ExtensionSourceSummary;
  artifact?: {
    sha256: string;
    size: number;
  };
  permissions: {
    requested: ExtensionPermission[];
    added: ExtensionPermission[];
    removed: ExtensionPermission[];
  };
  effects: OperationEffect[];
  compatibility: CompatibilityResult;
  rollback: {
    supported: boolean;
    strategy: string;
  };
  planDigest: string;
}
```

The digest MUST be calculated over a canonical representation excluding
`planDigest` itself. The plan MUST be regenerated when source, version,
manifest, permission set, dependency result, configuration target, or current
registration changes.

Effects are host-defined safe summaries, for example:

```ts
type OperationEffect =
  | { type: "install-artifact"; version: string; bytes: number }
  | { type: "activate-assets"; mount: string }
  | { type: "load-provider-code"; entryDigest: string }
  | { type: "manage-gateway-profile"; target: string; profile: string }
  | { type: "require-dependency"; name: string; supportedVersions: string };
```

The plan MUST NOT accept arbitrary display text supplied by executable package
code.

## 11. Installed registry

```ts
interface InstalledExtensionRegistration {
  registryVersion: 3;
  id: string;
  kind: ExtensionKind;
  version: string;
  source: ExtensionSource;
  artifactIntegrity: string;
  packageTreeDigest: string;
  manifestDigest: string;
  permissions: ExtensionPermission[];
  confirmation: PlanConfirmation;
  enabled: boolean;
  installPath?: string;
  deployments?: Record<string, ManagedDeploymentRegistration>;
  installedAt: string;
  updatedAt: string;
  previous?: PreviousRegistrationSummary;
}
```

Registry writes MUST be atomic. Unknown or corrupt registrations MUST be
disabled and surfaced for recovery rather than partially loaded.

The registry MUST NOT contain raw secrets.

## 12. State machine

```text
not-installed
  → staged
  → installed-disabled
  → enabled

installed-disabled ↔ enabled
enabled → update-staged → installed-disabled → enabled
installed-* → removing → not-installed

any mutating state → failed-disabled
failed-disabled → repair-staged → installed-disabled
```

Executable code MUST NOT load in `staged`, `installed-disabled`, or
`failed-disabled`.

Gateway deployments have a nested state per target:

```text
not-deployed → deploying → deployed → degraded
                         ↘ failed
deployed → undeploying → not-deployed
```

## 13. Host API compatibility

An executable manifest declares an `apiVersion`. Tower MUST reject a provider
whose API major version is unsupported. Additive host methods increment the
minor version. Removing or changing method behavior requires a new major
version.

The SDK MUST publish:

- the API compatibility table;
- deprecation annotations;
- a test host for each supported API major;
- a validator capable of running without the Tower repository.

## 14. Local development

A local package is registered from an explicit directory after the same
manifest, package, compatibility, and permission validation used for Catalog
packages.

Differences:

- source trust is always `unverified`;
- integrity is derived from the current package tree;
- Tower displays a persistent development badge;
- file changes invalidate the previous plan and permission confirmation;
- production policy MAY disable the feature.

Local registration MUST NOT mutate the official Catalog registration with the
same extension ID.

## 15. Error contract

Extension APIs return stable error codes plus safe detail:

```ts
type ExtensionErrorCode =
  | "CATALOG_UNAVAILABLE"
  | "CATALOG_INVALID"
  | "ENTRY_NOT_FOUND"
  | "ARTIFACT_INVALID"
  | "INTEGRITY_MISMATCH"
  | "MANIFEST_INVALID"
  | "KIND_UNSUPPORTED"
  | "INCOMPATIBLE"
  | "PERMISSION_REQUIRED"
  | "PLAN_STALE"
  | "DEPENDENCY_MISSING"
  | "OPERATION_CONFLICT"
  | "APPLY_FAILED"
  | "VERIFY_FAILED"
  | "ROLLBACK_FAILED"
  | "REGISTRY_CORRUPT";
```

Raw child-process output, secret values, and unrestricted filesystem paths MUST
NOT be returned to non-developer UI.

## 16. Conformance

An external package is conformant when:

1. it validates against its kind's manifest schema;
2. it builds using only the published SDK and allowed dependencies;
3. its artifact is deterministic under the documented build environment;
4. it passes kind-specific SDK contract tests;
5. it contains no forbidden scripts, native modules, or path escapes;
6. all runtime capability use is covered by declared permissions.

The official Catalog publication pipeline MUST reject non-conformant packages.

## 17. Deferred specification items

- artifact signing and publisher key rotation;
- revocation-list transport;
- custom UI protocol;
- cross-extension dependencies;
- extension-to-extension messaging;
- remote extension execution;
- multiple Catalog priority and enterprise mirroring policy.
