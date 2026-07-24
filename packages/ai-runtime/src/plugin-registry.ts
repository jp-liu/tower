import path from "node:path";
import { pluginError } from "./plugin-errors.js";
import type { PluginFileSystem } from "./plugin-filesystem.js";
import { NodePluginFileSystem } from "./plugin-filesystem.js";
import type {
  PluginRegistration,
  PluginRegistryData,
  RegistryRecoveryResult,
} from "./plugin-types.js";
import { PLUGIN_REGISTRY_VERSION } from "./plugin-types.js";

function emptyRegistry(): PluginRegistryData {
  return { version: PLUGIN_REGISTRY_VERSION, plugins: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PLUGIN_PERMISSIONS = new Set([
  "process:spawn",
  "filesystem:plugin-storage",
  "filesystem:provider-config",
  "network:provider",
  "integration:mcp",
  "integration:hooks",
  "integration:skills",
]);

function isPermissionArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && value.every((permission) => typeof permission === "string" && PLUGIN_PERMISSIONS.has(permission));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isManifestSummary(value: unknown): boolean {
  return isRecord(value)
    && typeof value.digest === "string"
    && typeof value.entryDigest === "string"
    && typeof value.configSchemaDigest === "string"
    && value.manifestVersion === 1
    && typeof value.apiVersion === "string"
    && value.kind === "cli-provider"
    && typeof value.displayName === "string";
}

function isPermissionConfirmation(value: unknown): boolean {
  return value === null || (isRecord(value)
    && isPermissionArray(value.permissions)
    && typeof value.planDigest === "string"
    && isTimestamp(value.confirmedAt));
}

function isRegistration(value: unknown, id: string): value is PluginRegistration {
  if (!isRecord(value)) return false;
  return value.id === id
    && typeof value.version === "string"
    && typeof value.integrity === "string"
    && (value.source === "npm" || value.source === "local")
    && typeof value.installPath === "string"
    && path.isAbsolute(value.installPath)
    && isManifestSummary(value.manifest)
    && isPermissionArray(value.permissions)
    && typeof value.activationPlanDigest === "string"
    && isPermissionConfirmation(value.permissionConfirmation)
    && typeof value.enabled === "boolean"
    && isTimestamp(value.installedAt)
    && isTimestamp(value.updatedAt);
}

function parseRegistry(contents: string): PluginRegistryData {
  try {
    const value = JSON.parse(contents) as unknown;
    if (!isRecord(value)
      || value.version !== PLUGIN_REGISTRY_VERSION
      || !isRecord(value.plugins)
      || Object.entries(value.plugins).some(([id, registration]) => !isRegistration(registration, id))) {
      throw new Error("Invalid plugin registry structure");
    }
    return value as unknown as PluginRegistryData;
  } catch (error) {
    throw pluginError("REGISTRY_CORRUPT", undefined, error);
  }
}

export interface PluginRegistryOptions {
  dataRoot: string;
  fileSystem?: PluginFileSystem;
}

export class PluginRegistry {
  readonly baseDir: string;
  readonly packagesDir: string;
  readonly stagingDir: string;
  readonly registryPath: string;
  private readonly fileSystem: PluginFileSystem;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: PluginRegistryOptions) {
    if (!path.isAbsolute(options.dataRoot)) throw new TypeError("Plugin dataRoot must be absolute");
    this.fileSystem = options.fileSystem ?? new NodePluginFileSystem();
    this.baseDir = path.join(path.resolve(options.dataRoot), "ai", "plugins");
    this.packagesDir = path.join(this.baseDir, "packages");
    this.stagingDir = path.join(this.baseDir, ".staging");
    this.registryPath = path.join(this.baseDir, "registry.v1.json");
  }

  async initialize(): Promise<void> {
    await this.fileSystem.mkdir(this.packagesDir);
    await this.fileSystem.mkdir(this.stagingDir);
  }

  async list(): Promise<PluginRegistration[]> {
    const data = await this.read();
    return Object.values(data.plugins).sort((left, right) => left.id.localeCompare(right.id));
  }

  async get(pluginId: string): Promise<PluginRegistration | null> {
    return (await this.read()).plugins[pluginId] ?? null;
  }

  async set(registration: PluginRegistration): Promise<void> {
    await this.mutate((registry) => {
      registry.plugins[registration.id] = registration;
    });
  }

  async remove(pluginId: string): Promise<PluginRegistration | null> {
    let removed: PluginRegistration | null = null;
    await this.mutate((registry) => {
      removed = registry.plugins[pluginId] ?? null;
      delete registry.plugins[pluginId];
    });
    return removed;
  }

  async update(
    pluginId: string,
    updater: (registration: PluginRegistration) => PluginRegistration,
  ): Promise<PluginRegistration> {
    let updated: PluginRegistration | null = null;
    await this.mutate((registry) => {
      const current = registry.plugins[pluginId];
      if (!current) throw pluginError("PLUGIN_NOT_FOUND", pluginId);
      updated = updater(current);
      registry.plugins[pluginId] = updated;
    });
    return updated as unknown as PluginRegistration;
  }

  async recover(): Promise<RegistryRecoveryResult> {
    return this.serialized(async () => {
      await this.initialize();
      const release = await this.fileSystem.acquireLock(`${this.registryPath}.lock`);
      try {
        try {
          await this.readUnlocked();
          return { recovered: false };
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "REGISTRY_CORRUPT") throw error;
          const backupFileName = `registry.v1.corrupt.${Date.now()}.json`;
          await this.fileSystem.rename(this.registryPath, path.join(this.baseDir, backupFileName));
          await this.fileSystem.atomicWrite(this.registryPath, `${JSON.stringify(emptyRegistry(), null, 2)}\n`);
          return { recovered: true, backupFileName };
        }
      } finally {
        await release();
      }
    });
  }

  private async read(): Promise<PluginRegistryData> {
    await this.initialize();
    return this.readUnlocked();
  }

  private async readUnlocked(): Promise<PluginRegistryData> {
    try {
      const contents = (await this.fileSystem.readFile(this.registryPath)).toString("utf8");
      return parseRegistry(contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRegistry();
      if (error instanceof Error && "code" in error && error.code === "REGISTRY_CORRUPT") throw error;
      throw pluginError("REGISTRY_CORRUPT", undefined, error);
    }
  }

  private async mutate(mutator: (registry: PluginRegistryData) => void): Promise<void> {
    await this.serialized(async () => {
      await this.initialize();
      const release = await this.fileSystem.acquireLock(`${this.registryPath}.lock`);
      try {
        const registry = await this.readUnlocked();
        mutator(registry);
        await this.fileSystem.atomicWrite(this.registryPath, `${JSON.stringify(registry, null, 2)}\n`);
      } finally {
        await release();
      }
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
