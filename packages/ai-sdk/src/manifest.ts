export const CLI_PLUGIN_MANIFEST_VERSION = 1 as const;
export const CLI_PLUGIN_API_VERSION = "1.0" as const;

export type CliPluginApiVersion = `${number}` | `${number}.${number}`;
export type CliPluginKind = "cli-provider";
export type SupportedPlatform = "darwin" | "linux" | "win32";

export type CliPluginPermission =
  | "process:spawn"
  | "filesystem:plugin-storage"
  | "filesystem:provider-config"
  | "network:provider"
  | "integration:mcp"
  | "integration:hooks"
  | "integration:skills";

export interface CliCapabilityManifest {
  sessions: {
    fresh: true;
    resume?: boolean;
    continue?: boolean;
  };
  query: {
    generate: true;
    stream?: boolean;
  };
  models: boolean;
  integrations?: {
    mcp?: boolean;
    hooks?: boolean;
    skills?: boolean;
  };
}

export interface CliCommandManifest {
  default: string;
  aliases?: string[];
  knownPaths?: Partial<Record<SupportedPlatform, string[]>>;
  versionArgs: string[];
}

export interface CliPluginPublisher {
  id: string;
  name: string;
  homepage?: string;
}

export interface CliDependencyManifest {
  name: string;
  homepage: string;
  installDocs: string;
  supportedVersions: string;
  managedByTower: false;
}

export interface CliPluginManifestV1 {
  manifestVersion: typeof CLI_PLUGIN_MANIFEST_VERSION;
  apiVersion: CliPluginApiVersion;
  id: string;
  kind: CliPluginKind;
  publisher: CliPluginPublisher;
  display: {
    name: string;
    description?: string;
    homepage?: string;
  };
  entry: string;
  command: CliCommandManifest;
  cliDependency: CliDependencyManifest;
  compatibility: {
    tower: string;
    node: string;
  };
  capabilities: CliCapabilityManifest;
  permissions: CliPluginPermission[];
  configSchema: string;
}

const CLI_PLUGIN_PERMISSIONS = new Set<CliPluginPermission>([
  "process:spawn",
  "filesystem:plugin-storage",
  "filesystem:provider-config",
  "network:provider",
  "integration:mcp",
  "integration:hooks",
  "integration:skills",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasValidOptionalField(
  value: Record<string, unknown>,
  key: string,
  validate: (field: unknown) => boolean,
): boolean {
  return !hasOwn(value, key) || validate(value[key]);
}

function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isStableIdentifier(value: unknown): value is string {
  return isNonEmptyString(value)
    && value.length <= 128
    && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
}

function isSafeRelativeFile(value: unknown): value is string {
  return isNonEmptyString(value)
    && /^\.\/[A-Za-z0-9._/-]+$/.test(value)
    && !value.split(/[\\/]/).some((segment) => segment === ".." || segment === "");
}

/** Validate the static package.json `tower` field before plugin code is loaded. */
export function isCliPluginManifestV1(value: unknown): value is CliPluginManifestV1 {
  if (!isRecord(value)) return false;
  if (value.manifestVersion !== CLI_PLUGIN_MANIFEST_VERSION || value.kind !== "cli-provider") return false;
  if (!isNonEmptyString(value.apiVersion) || !parseApiVersion(value.apiVersion)) return false;
  if (!isStableIdentifier(value.id)) return false;
  if (!isRecord(value.publisher)
    || !isStableIdentifier(value.publisher.id)
    || !isNonEmptyString(value.publisher.name)
    || !hasValidOptionalField(value.publisher, "homepage", isHttpsUrl)) return false;
  if (!isRecord(value.display)
    || !isNonEmptyString(value.display.name)
    || !hasValidOptionalField(value.display, "description", isString)
    || !hasValidOptionalField(value.display, "homepage", isString)) return false;

  if (!isSafeRelativeFile(value.entry)) return false;
  if (!isRecord(value.command) || !isNonEmptyString(value.command.default)) return false;
  if (!hasValidOptionalField(value.command, "aliases", isNonEmptyStringArray)
    || !isNonEmptyStringArray(value.command.versionArgs)) return false;
  if (hasOwn(value.command, "knownPaths")) {
    if (!isRecord(value.command.knownPaths)) return false;
    for (const [platform, paths] of Object.entries(value.command.knownPaths)) {
      if (!(["darwin", "linux", "win32"] as string[]).includes(platform)) return false;
      if (!isNonEmptyStringArray(paths)) return false;
    }
  }

  if (!isRecord(value.cliDependency)
    || !isNonEmptyString(value.cliDependency.name)
    || !isHttpsUrl(value.cliDependency.homepage)
    || !isHttpsUrl(value.cliDependency.installDocs)
    || !isNonEmptyString(value.cliDependency.supportedVersions)
    || value.cliDependency.managedByTower !== false) return false;

  if (!isRecord(value.compatibility)
    || !isNonEmptyString(value.compatibility.tower)
    || !isNonEmptyString(value.compatibility.node)) return false;

  if (!isRecord(value.capabilities)) return false;
  const sessions = value.capabilities.sessions;
  const query = value.capabilities.query;
  if (!isRecord(sessions)
    || sessions.fresh !== true
    || !hasValidOptionalField(sessions, "resume", (field) => typeof field === "boolean")
    || !hasValidOptionalField(sessions, "continue", (field) => typeof field === "boolean")) return false;
  if (!isRecord(query)
    || query.generate !== true
    || !hasValidOptionalField(query, "stream", (field) => typeof field === "boolean")) return false;
  if (typeof value.capabilities.models !== "boolean") return false;
  if (hasOwn(value.capabilities, "integrations")) {
    const integrations = value.capabilities.integrations;
    if (!isRecord(integrations)
      || !hasValidOptionalField(integrations, "mcp", (field) => typeof field === "boolean")
      || !hasValidOptionalField(integrations, "hooks", (field) => typeof field === "boolean")
      || !hasValidOptionalField(integrations, "skills", (field) => typeof field === "boolean")) return false;
  }

  if (!Array.isArray(value.permissions)
    || !value.permissions.every((permission) => typeof permission === "string"
      && CLI_PLUGIN_PERMISSIONS.has(permission as CliPluginPermission))) return false;
  return isNonEmptyString(value.configSchema);
}

/** Detect the pre-Catalog v1 shape so hosts can return a migration diagnostic. */
export function isLegacyCliPluginManifestV1(value: unknown): boolean {
  return isRecord(value)
    && value.manifestVersion === CLI_PLUGIN_MANIFEST_VERSION
    && value.kind === "cli-provider"
    && (!hasOwn(value, "id")
      || !hasOwn(value, "publisher")
      || !hasOwn(value, "entry")
      || !hasOwn(value, "cliDependency"));
}

function parseApiVersion(version: string): [major: number, minor: number] | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0)];
}

/** A host supports plugin API versions from the same major up to its own minor. */
export function isCliPluginApiVersionCompatible(
  requested: string,
  host: string = CLI_PLUGIN_API_VERSION,
): boolean {
  const pluginVersion = parseApiVersion(requested);
  const hostVersion = parseApiVersion(host);
  if (!pluginVersion || !hostVersion) return false;
  return pluginVersion[0] === hostVersion[0] && pluginVersion[1] <= hostVersion[1];
}
