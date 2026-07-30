import {
  EXTENSION_MANIFEST_VERSION,
  type ExtensionKind,
  type ExtensionManifestV2,
  type ExtensionPermission,
} from "./manifest.js";
import semver from "semver";

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const API_VERSION_PATTERN = /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/;
const CAPABILITY_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;
const MOUNT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LIST_ITEMS = 100;
const MAX_STRING_LENGTH = 4_096;

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
  return typeof value === "string"
    && value === value.trim()
    && value.length > 0
    && value.length <= MAX_STRING_LENGTH;
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
  if (!isNonEmptyString(value)
    || value.startsWith("/")
    || value.includes("\\")
    || value.includes(":")
    || /[\u0000-\u001f\u007f]/.test(value)) return false;
  const segments = value.split("/");
  return segments.length > 0
    && segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    && segments.join("/") === value;
}

function isUniqueStringList(
  value: unknown,
  predicate: (entry: string) => boolean,
): value is string[] {
  if (!Array.isArray(value)
    || value.length > MAX_LIST_ITEMS
    || !value.every((entry): entry is string => isNonEmptyString(entry) && predicate(entry))) {
    return false;
  }
  return new Set(value).size === value.length;
}

function validCommonFields(value: Record<string, unknown>): boolean {
  if (!hasOnlyKeys(value, COMMON_KEYS)
    || value.manifestVersion !== EXTENSION_MANIFEST_VERSION
    || !isNonEmptyString(value.id)
    || value.id.length > 128
    || !ID_PATTERN.test(value.id)
    || typeof value.version !== "string"
    || semver.valid(value.version) !== value.version
    || typeof value.apiVersion !== "string"
    || !API_VERSION_PATTERN.test(value.apiVersion)
    || !isRecord(value.engines)
    || !hasOnlyKeys(value.engines, new Set(["tower", "extensionSdk"]))
    || !isNonEmptyString(value.engines.tower)
    || semver.validRange(value.engines.tower) === null
    || !isNonEmptyString(value.engines.extensionSdk)
    || semver.validRange(value.engines.extensionSdk) === null
    || !isRecord(value.display)
    || !hasOnlyKeys(value.display, new Set(["name", "description", "homepage", "icon"]))
    || !isNonEmptyString(value.display.name)
    || !isNonEmptyString(value.display.description)
    || (value.display.homepage !== undefined && !isHttpsUrl(value.display.homepage))
    || (value.display.icon !== undefined && !isRelativePackagePath(value.display.icon))
    || !isUniqueStringList(value.capabilities, (entry) => CAPABILITY_PATTERN.test(entry))
    || !isUniqueStringList(value.permissions, () => true)) return false;

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
      && typeof value.entrypoints.activation.mount === "string"
      && MOUNT_PATTERN.test(value.entrypoints.activation.mount);
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

class JsonCursor {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.source.length) throw new Error("Invalid JSON");
    return value;
  }

  private parseValue(): unknown {
    this.skipWhitespace();
    const char = this.source[this.index];
    if (char === "{") return this.parseObject();
    if (char === "[") return this.parseArray();
    if (char === "\"") return this.parseString();
    const match = this.source.slice(this.index).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/);
    if (!match) throw new Error("Invalid JSON");
    this.index += match[0].length;
    return JSON.parse(match[0]) as unknown;
  }

  private parseObject(): Record<string, unknown> {
    this.index += 1;
    const result = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      this.skipWhitespace();
      if (this.source[this.index] !== "\"") throw new Error("Invalid JSON object key");
      const key = this.parseString();
      if (keys.has(key)) throw new Error(`Duplicate JSON key: ${key}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ":") throw new Error("Invalid JSON object");
      this.index += 1;
      result[key] = this.parseValue();
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") throw new Error("Invalid JSON object");
      this.index += 1;
    }
  }

  private parseArray(): unknown[] {
    this.index += 1;
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      this.skipWhitespace();
      const delimiter = this.source[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return result;
      }
      if (delimiter !== ",") throw new Error("Invalid JSON array");
      this.index += 1;
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === "\"") {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index)) as string;
      }
      if (char === "\\") this.index += 1;
      this.index += 1;
    }
    throw new Error("Unterminated JSON string");
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length && /\s/.test(this.source[this.index]!)) {
      this.index += 1;
    }
  }
}

export function parseExtensionManifestJson(source: string): ExtensionManifestV2 {
  if (typeof source !== "string" || new TextEncoder().encode(source).byteLength > 1024 * 1024) {
    throw new Error("Invalid Tower extension manifest v2");
  }
  try {
    return parseExtensionManifestV2(new JsonCursor(source).parse());
  } catch {
    throw new Error("Invalid Tower extension manifest v2");
  }
}
