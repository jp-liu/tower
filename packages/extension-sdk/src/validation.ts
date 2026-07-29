import {
  EXTENSION_MANIFEST_VERSION,
  type ExtensionKind,
  type ExtensionManifestV2,
  type ExtensionPermission,
} from "./manifest.js";

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\0]+$/;

const COMMON_KEYS = new Set([
  "manifestVersion",
  "id",
  "version",
  "kind",
  "apiVersion",
  "engines",
  "display",
  "capabilities",
  "permissions",
  "configuration",
  "entrypoints",
]);

const PERMISSIONS_BY_KIND: Record<ExtensionKind, ReadonlySet<ExtensionPermission>> = {
  "tower-component": new Set(),
  "cli-provider": new Set([
    "process:cli",
    "config:read",
    "config:write",
    "secrets:read-scoped",
    "workspace:read",
  ]),
  "gateway-adapter": new Set([
    "gateway:openclaw-profile",
    "gateway:hermes-profile",
  ]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isRelativePackagePath(value: unknown): value is string {
  return isNonEmptyString(value) && RELATIVE_PATH_PATTERN.test(value);
}

function validCommonFields(value: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(value, COMMON_KEYS)
    || value.manifestVersion !== EXTENSION_MANIFEST_VERSION
    || !isNonEmptyString(value.id)
    || value.id.length > 128
    || !ID_PATTERN.test(value.id)
    || typeof value.version !== "string"
    || !VERSION_PATTERN.test(value.version)
    || !isNonEmptyString(value.apiVersion)
    || !isRecord(value.engines)
    || !hasOnlyKeys(value.engines, new Set(["tower", "extensionSdk"]))
    || !isNonEmptyString(value.engines.tower)
    || !isNonEmptyString(value.engines.extensionSdk)
    || !isRecord(value.display)
    || !hasOnlyKeys(value.display, new Set(["name", "description", "homepage", "icon"]))
    || !isNonEmptyString(value.display.name)
    || !isNonEmptyString(value.display.description)
    || (value.display.homepage !== undefined && !isHttpsUrl(value.display.homepage))
    || (value.display.icon !== undefined && !isRelativePackagePath(value.display.icon))
    || !Array.isArray(value.capabilities)
    || !value.capabilities.every(isNonEmptyString)
    || !Array.isArray(value.permissions)
    || !value.permissions.every(isNonEmptyString)) return false;

  if (value.configuration !== undefined) {
    if (!isRecord(value.configuration)
      || !hasOnlyKeys(value.configuration, new Set(["schema"]))
      || !isRelativePackagePath(value.configuration.schema)) return false;
  }
  return true;
}

export function isExtensionManifestV2(value: unknown): value is ExtensionManifestV2 {
  if (!isRecord(value) || !validCommonFields(value)) return false;
  if (value.kind !== "tower-component"
    && value.kind !== "cli-provider"
    && value.kind !== "gateway-adapter") return false;

  const allowedPermissions = PERMISSIONS_BY_KIND[value.kind];
  if (!(value.permissions as string[]).every((permission) =>
    allowedPermissions.has(permission as ExtensionPermission))) return false;
  if (!isRecord(value.entrypoints)) return false;

  if (value.kind === "tower-component") {
    return hasOnlyKeys(value.entrypoints, new Set(["assets", "activation"]))
      && isRelativePackagePath(value.entrypoints.assets)
      && isRecord(value.entrypoints.activation)
      && hasOnlyKeys(value.entrypoints.activation, new Set(["type", "mount"]))
      && value.entrypoints.activation.type === "static-assets"
      && isNonEmptyString(value.entrypoints.activation.mount);
  }
  if (value.kind === "cli-provider") {
    return hasOnlyKeys(value.entrypoints, new Set(["provider", "configSchema"]))
      && isRelativePackagePath(value.entrypoints.provider)
      && isRelativePackagePath(value.entrypoints.configSchema);
  }
  return hasOnlyKeys(value.entrypoints, new Set(["resources", "deployment"]))
    && isRelativePackagePath(value.entrypoints.resources)
    && isRelativePackagePath(value.entrypoints.deployment);
}

export function parseExtensionManifestV2(value: unknown): ExtensionManifestV2 {
  if (!isExtensionManifestV2(value)) {
    throw new Error("Invalid Tower extension manifest v2");
  }
  return structuredClone(value);
}

