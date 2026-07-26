import semver from "semver";
import { pluginError } from "./plugin-errors.js";

export const EXTENSION_CATALOG_VERSION = 1 as const;
export const MAX_EXTENSION_CATALOG_BYTES = 2 * 1024 * 1024;
export const MAX_EXTENSION_ARTIFACT_BYTES = 100 * 1024 * 1024;

export interface CatalogPublisher {
  id: string;
  name: string;
}

export interface CatalogArtifact {
  url: string;
  sha256: string;
  size: number;
}

export interface CatalogCliDependencyDisplay {
  name: string;
  supportedVersions: string;
  installDocs: string;
}

export interface CatalogExtensionVersion {
  version: string;
  artifact: CatalogArtifact;
  cliDependency?: CatalogCliDependencyDisplay;
}

export interface CatalogExtension {
  id: string;
  kind: "cli-provider";
  publisher: CatalogPublisher;
  display: {
    name: string;
    description?: string;
    homepage?: string;
  };
  versions: CatalogExtensionVersion[];
}

export interface ExtensionCatalogIndexV1 {
  schemaVersion: typeof EXTENSION_CATALOG_VERSION;
  extensions: CatalogExtension[];
}

export interface ExtensionCatalog {
  read(): Promise<ExtensionCatalogIndexV1>;
}

export type CatalogFetch = (url: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStableId(value: unknown): value is string {
  return isNonEmptyString(value)
    && value.length <= 128
    && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
}

export function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parsePublisher(value: unknown): CatalogPublisher {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["id", "name"])
    || !isStableId(value.id)
    || !isNonEmptyString(value.name)) throw pluginError("CATALOG_INVALID");
  return { id: value.id, name: value.name };
}

function parseArtifact(value: unknown): CatalogArtifact {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["url", "sha256", "size"])
    || !isHttpsUrl(value.url)
    || typeof value.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.sha256)
    || !Number.isSafeInteger(value.size)
    || (value.size as number) <= 0
    || (value.size as number) > MAX_EXTENSION_ARTIFACT_BYTES) {
    throw pluginError("CATALOG_INVALID");
  }
  return { url: value.url, sha256: value.sha256, size: value.size as number };
}

function parseCliDependency(value: unknown): CatalogCliDependencyDisplay {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["name", "supportedVersions", "installDocs"])
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.supportedVersions)
    || !isHttpsUrl(value.installDocs)) throw pluginError("CATALOG_INVALID");
  return {
    name: value.name,
    supportedVersions: value.supportedVersions,
    installDocs: value.installDocs,
  };
}

export function parseExtensionCatalog(value: unknown): ExtensionCatalogIndexV1 {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["schemaVersion", "extensions"])
    || value.schemaVersion !== EXTENSION_CATALOG_VERSION
    || !Array.isArray(value.extensions)) throw pluginError("CATALOG_INVALID");
  const seenIds = new Set<string>();
  const extensions = value.extensions.map((raw): CatalogExtension => {
    if (!isRecord(raw)
      || !hasOnlyKeys(raw, ["id", "kind", "publisher", "display", "versions"])
      || !isStableId(raw.id)
      || raw.kind !== "cli-provider"
      || !isRecord(raw.display)
      || !hasOnlyKeys(raw.display, ["name", "description", "homepage"])
      || !isNonEmptyString(raw.display.name)
      || (raw.display.description !== undefined && typeof raw.display.description !== "string")
      || (raw.display.homepage !== undefined && !isHttpsUrl(raw.display.homepage))
      || !Array.isArray(raw.versions)
      || raw.versions.length === 0
      || seenIds.has(raw.id)) throw pluginError("CATALOG_INVALID");
    seenIds.add(raw.id);
    const seenVersions = new Set<string>();
    const versions = raw.versions.map((entry): CatalogExtensionVersion => {
      if (!isRecord(entry)
        || !hasOnlyKeys(entry, ["version", "artifact", "cliDependency"])
        || typeof entry.version !== "string"
        || semver.valid(entry.version) !== entry.version
        || seenVersions.has(entry.version)) throw pluginError("CATALOG_INVALID");
      seenVersions.add(entry.version);
      return {
        version: entry.version,
        artifact: parseArtifact(entry.artifact),
        ...(entry.cliDependency === undefined
          ? {}
          : { cliDependency: parseCliDependency(entry.cliDependency) }),
      };
    });
    return {
      id: raw.id,
      kind: "cli-provider",
      publisher: parsePublisher(raw.publisher),
      display: {
        name: raw.display.name,
        ...(typeof raw.display.description === "string" ? { description: raw.display.description } : {}),
        ...(typeof raw.display.homepage === "string" ? { homepage: raw.display.homepage } : {}),
      },
      versions,
    };
  });
  return { schemaVersion: EXTENSION_CATALOG_VERSION, extensions };
}

export class StaticHttpExtensionCatalog implements ExtensionCatalog {
  private readonly indexUrl: string;
  private readonly fetchImpl: CatalogFetch;

  constructor(indexUrl: string, fetchImpl: CatalogFetch = fetch) {
    if (!isHttpsUrl(indexUrl)) throw pluginError("CATALOG_INVALID");
    this.indexUrl = indexUrl;
    this.fetchImpl = fetchImpl;
  }

  async read(): Promise<ExtensionCatalogIndexV1> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.indexUrl, {
        headers: { accept: "application/json" },
        redirect: "follow",
      });
    } catch (error) {
      throw pluginError("CATALOG_UNAVAILABLE", undefined, error);
    }
    if (!response.ok || (response.url && !isHttpsUrl(response.url))) {
      throw pluginError("CATALOG_UNAVAILABLE");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_EXTENSION_CATALOG_BYTES) {
      throw pluginError("CATALOG_INVALID");
    }
    try {
      const bytes = await readBoundedResponse(response, MAX_EXTENSION_CATALOG_BYTES);
      return parseExtensionCatalog(JSON.parse(new TextDecoder().decode(bytes)));
    } catch (error) {
      if (error instanceof Error && "code" in error) throw error;
      throw pluginError("CATALOG_INVALID", undefined, error);
    }
  }
}

async function readBoundedResponse(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw pluginError("CATALOG_INVALID");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export class FixtureExtensionCatalog implements ExtensionCatalog {
  constructor(private readonly value: unknown) {}

  async read(): Promise<ExtensionCatalogIndexV1> {
    return parseExtensionCatalog(structuredClone(this.value));
  }
}

export function findCatalogVersion(
  catalog: ExtensionCatalogIndexV1,
  extensionId: string,
  version: string,
): { extension: CatalogExtension; release: CatalogExtensionVersion } {
  const extension = catalog.extensions.find((entry) => entry.id === extensionId);
  const release = extension?.versions.find((entry) => entry.version === version);
  if (!extension || !release) throw pluginError("CATALOG_ENTRY_NOT_FOUND", extensionId);
  return { extension, release };
}

export function latestCatalogVersion(extension: CatalogExtension): CatalogExtensionVersion {
  return [...extension.versions].sort((left, right) => semver.rcompare(left.version, right.version))[0]!;
}
