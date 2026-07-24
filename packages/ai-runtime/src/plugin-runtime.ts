import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLI_PLUGIN_EXPORT_NAME,
  isCliAdapter,
  isCliPlugin,
  type CliAdapter,
  type CliHostContext,
} from "@tower/ai-sdk";
import { pluginError } from "./plugin-errors.js";
import { PluginRuntimeError } from "./plugin-errors.js";
import type { PluginFileSystem } from "./plugin-filesystem.js";
import { NodePluginFileSystem } from "./plugin-filesystem.js";
import {
  DefaultNpmPackageProvider,
  isValidPackageIntegrity,
  type NpmPackageProvider,
  type NpmPackageResolution,
} from "./npm-package-provider.js";
import { PluginRegistry } from "./plugin-registry.js";
import type {
  PluginInstallPlan,
  PluginRegistration,
  RegistryRecoveryResult,
  ValidatedPluginPackage,
} from "./plugin-types.js";
import {
  assertExactSemVer,
  assertValidPackageName,
  createInstallPlan,
  isMatchingPlan,
  isPathInside,
  sha256,
  stableJson,
  validatePluginPackage,
} from "./plugin-validation.js";

export type PluginModuleImporter = (specifier: string) => Promise<Record<string, unknown>>;

export interface CliPluginRuntimeOptions {
  dataRoot: string;
  towerVersion: string;
  nodeVersion?: string;
  fileSystem?: PluginFileSystem;
  npmProvider?: NpmPackageProvider;
  importModule?: PluginModuleImporter;
  now?: () => Date;
}

interface StagedNpmPackage {
  temporaryRoot: string;
  packageRoot: string;
  resolution: NpmPackageResolution;
  plugin: ValidatedPluginPackage;
}

function sameStringSet(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function packageDirectoryName(pluginId: string): string {
  return createHash("sha256").update(pluginId).digest("hex").slice(0, 32);
}

function installationDirectoryName(plan: PluginInstallPlan): string {
  return `${plan.toVersion}-${createHash("sha256")
    .update(`${plan.planDigest}:${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 16)}`;
}

export class CliPluginRuntime {
  readonly registry: PluginRegistry;
  private readonly fileSystem: PluginFileSystem;
  private readonly npmProvider: NpmPackageProvider;
  private readonly towerVersion: string;
  private readonly nodeVersion: string;
  private readonly importModule: PluginModuleImporter;
  private readonly now: () => Date;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: CliPluginRuntimeOptions) {
    this.fileSystem = options.fileSystem ?? new NodePluginFileSystem();
    this.registry = new PluginRegistry({ dataRoot: options.dataRoot, fileSystem: this.fileSystem });
    this.npmProvider = options.npmProvider ?? new DefaultNpmPackageProvider({ fileSystem: this.fileSystem });
    this.towerVersion = options.towerVersion;
    this.nodeVersion = options.nodeVersion ?? process.versions.node;
    this.importModule = options.importModule ?? (async (specifier) => import(specifier) as Promise<Record<string, unknown>>);
    this.now = options.now ?? (() => new Date());
  }

  list(): Promise<PluginRegistration[]> {
    return this.registry.list();
  }

  get(pluginId: string): Promise<PluginRegistration | null> {
    return this.registry.get(pluginId);
  }

  recoverRegistry(): Promise<RegistryRecoveryResult> {
    return this.registry.recover();
  }

  async planNpmInstall(packageName: string, version: string): Promise<PluginInstallPlan> {
    const staged = await this.stageNpmPackage(packageName, version);
    try {
      return createInstallPlan({
        source: "npm",
        plugin: staged.plugin,
        integrity: staged.resolution.integrity,
        previous: await this.registry.get(packageName) ?? undefined,
      });
    } finally {
      await this.fileSystem.rm(staged.temporaryRoot).catch(() => undefined);
    }
  }

  async installNpm(plan: PluginInstallPlan): Promise<PluginRegistration> {
    if (plan.source !== "npm") throw pluginError("INSTALL_PLAN_MISMATCH", plan.pluginId);
    return this.serialized(async () => {
      const staged = await this.stageNpmPackage(plan.pluginId, plan.toVersion);
      try {
        return await this.commitNpmPackage(staged, plan);
      } finally {
        await this.fileSystem.rm(staged.temporaryRoot).catch(() => undefined);
      }
    });
  }

  async planLocalRegistration(directory: string): Promise<PluginInstallPlan> {
    const packageRoot = await this.fileSystem.realpath(path.resolve(directory)).catch((error) => {
      throw pluginError("INVALID_PACKAGE", undefined, error);
    });
    const plugin = await this.validate(packageRoot);
    return createInstallPlan({
      source: "local",
      sourcePath: packageRoot,
      plugin,
      integrity: this.localIntegrity(plugin),
      previous: await this.registry.get(plugin.packageName) ?? undefined,
    });
  }

  async registerLocal(plan: PluginInstallPlan): Promise<PluginRegistration> {
    if (plan.source !== "local" || !plan.sourcePath) {
      throw pluginError("INSTALL_PLAN_MISMATCH", plan.pluginId);
    }
    return this.serialized(async () => {
      const packageRoot = await this.fileSystem.realpath(path.resolve(plan.sourcePath!)).catch((error) => {
        throw pluginError("INVALID_PACKAGE", plan.pluginId, error);
      });
      const plugin = await this.validate(packageRoot, plan.pluginId, plan.toVersion);
      return this.withLifecycleLock(plan.pluginId, () =>
        this.registry.transact(plan.pluginId, (current) => {
          const expected = createInstallPlan({
            source: "local",
            sourcePath: packageRoot,
            plugin,
            integrity: this.localIntegrity(plugin),
            previous: current ?? undefined,
          });
          if (!isMatchingPlan(expected, plan)) throw pluginError("INSTALL_PLAN_MISMATCH", plan.pluginId);
          const registration = this.createRegistration(expected, packageRoot, current ?? undefined);
          return { next: registration, result: registration };
        })
      );
    });
  }

  async confirmAndEnable(pluginId: string, plan: PluginInstallPlan): Promise<PluginRegistration> {
    return this.serialized(async () => this.registry.transact(pluginId, (current) => {
      if (!current) throw pluginError("PLUGIN_NOT_FOUND", pluginId);
      if (plan.pluginId !== pluginId
        || plan.planDigest !== current.activationPlanDigest
        || !isMatchingPlan(plan, plan)
        || plan.toVersion !== current.version
        || plan.integrity !== current.integrity
        || plan.manifest.digest !== current.manifest.digest
        || !sameStringSet(plan.permissions.requested, current.permissions)) {
        throw pluginError("INSTALL_PLAN_MISMATCH", pluginId);
      }
      const confirmedAt = this.now().toISOString();
      const enabled = {
        ...current,
        enabled: true,
        permissionConfirmation: {
          permissions: [...current.permissions].sort(),
          planDigest: plan.planDigest,
          confirmedAt,
        },
        updatedAt: confirmedAt,
      };
      return { next: enabled, result: enabled };
    }));
  }

  async disable(pluginId: string): Promise<PluginRegistration> {
    return this.serialized(async () => this.registry.update(pluginId, (current) => ({
      ...current,
      enabled: false,
      updatedAt: this.now().toISOString(),
    })));
  }

  async uninstall(pluginId: string): Promise<void> {
    await this.serialized(async () => {
      const snapshot = await this.registry.get(pluginId);
      if (!snapshot) throw pluginError("PLUGIN_NOT_FOUND", pluginId);
      const container = this.packageContainer(pluginId);
      if (snapshot.source === "npm") {
        const installPath = path.resolve(snapshot.installPath);
        if (installPath === container || !isPathInside(container, installPath)) {
          throw pluginError("UNINSTALL_FAILED", pluginId);
        }
      }
      try {
        const trash = await this.withLifecycleLock(pluginId, async () => {
          const current = await this.registry.get(pluginId);
          if (!current) throw pluginError("PLUGIN_NOT_FOUND", pluginId);
          if (!this.sameRegistration(current, snapshot)) throw pluginError("UNINSTALL_FAILED", pluginId);
          const trash = path.join(
            this.registry.stagingDir,
            `.uninstall-${packageDirectoryName(pluginId)}-${randomUUID()}`,
          );
          const containerExists = await this.exists(container);
          let movedToTrash = false;
          try {
            if (containerExists) {
              await this.fileSystem.rename(container, trash);
              movedToTrash = true;
            }
            await this.registry.transact(pluginId, (current) => {
              if (!current) throw pluginError("PLUGIN_NOT_FOUND", pluginId);
              if (!this.sameRegistration(current, snapshot)) throw pluginError("UNINSTALL_FAILED", pluginId);
              return { next: null, result: undefined };
            });
          } catch (error) {
            if (movedToTrash && await this.exists(trash)) {
              await this.fileSystem.rename(trash, container).catch(() => undefined);
            }
            throw error;
          }
          return movedToTrash ? trash : null;
        });
        if (trash) await this.fileSystem.rm(trash).catch(() => undefined);
      } catch (error) {
        if (error instanceof PluginRuntimeError && error.code === "PLUGIN_NOT_FOUND") throw error;
        if (error instanceof PluginRuntimeError && error.code === "UNINSTALL_FAILED") throw error;
        throw pluginError("UNINSTALL_FAILED", pluginId);
      }
    });
  }

  async load(
    pluginId: string,
    host: CliHostContext,
    settings: Readonly<Record<string, unknown>> = {},
  ): Promise<CliAdapter> {
    const registration = await this.registry.get(pluginId);
    if (!registration) throw pluginError("PLUGIN_NOT_FOUND", pluginId);
    if (!registration.enabled) throw pluginError("PLUGIN_DISABLED", pluginId);
    if (!registration.permissionConfirmation
      || !sameStringSet(registration.permissions, registration.permissionConfirmation.permissions)) {
      throw pluginError("PERMISSION_CONFIRMATION_REQUIRED", pluginId);
    }

    const packageRoot = await this.resolveRegisteredRoot(registration);
    const pluginPackage = await this.validate(
      packageRoot,
      registration.id,
      registration.version,
      registration.source === "npm",
    ).catch((error) => {
      throw pluginError("PLUGIN_CORRUPT", pluginId, error);
    });
    if (stableJson(pluginPackage.manifestSummary) !== stableJson(registration.manifest)) {
      throw pluginError("PLUGIN_CORRUPT", pluginId);
    }
    if (registration.source === "local" && this.localIntegrity(pluginPackage) !== registration.integrity) {
      throw pluginError("PLUGIN_CORRUPT", pluginId);
    }

    let loadedModule: Record<string, unknown>;
    try {
      const cacheKey = encodeURIComponent(`${registration.version}:${registration.manifest.entryDigest}`);
      loadedModule = await this.importModule(`${pathToFileURL(pluginPackage.entryPath).href}?tower=${cacheKey}`);
    } catch (error) {
      throw pluginError("INVALID_PLUGIN_EXPORT", pluginId, error);
    }
    const exported = loadedModule[CLI_PLUGIN_EXPORT_NAME];
    if (!isCliPlugin(exported)
      || sha256(stableJson(exported.manifest)) !== pluginPackage.manifestSummary.digest) {
      throw pluginError("INVALID_PLUGIN_EXPORT", pluginId);
    }
    let adapter: unknown;
    try {
      adapter = exported.createAdapter(host, settings);
    } catch (error) {
      throw pluginError("INVALID_ADAPTER", pluginId, error);
    }
    if (!isCliAdapter(adapter)) throw pluginError("INVALID_ADAPTER", pluginId);
    return adapter;
  }

  private async stageNpmPackage(packageName: string, version: string): Promise<StagedNpmPackage> {
    assertValidPackageName(packageName);
    assertExactSemVer(version);
    let resolution: NpmPackageResolution;
    try {
      resolution = await this.npmProvider.resolve(packageName, version);
    } catch (error) {
      if (error instanceof PluginRuntimeError) throw error;
      throw pluginError("PACKAGE_NOT_FOUND", packageName, error);
    }
    if (resolution.packageName !== packageName
      || resolution.version !== version
      || !isValidPackageIntegrity(resolution.integrity)) {
      throw pluginError("INTEGRITY_MISMATCH", packageName);
    }
    await this.registry.initialize();
    const temporaryRoot = await this.fileSystem.mkdtemp(path.join(this.registry.stagingDir, ".install-"));
    const packageRoot = path.join(temporaryRoot, "package");
    try {
      try {
        await this.npmProvider.stage(resolution, packageRoot);
      } catch (error) {
        if (error instanceof PluginRuntimeError) throw error;
        throw pluginError("INSTALL_FAILED", packageName, error);
      }
      const plugin = await this.validate(packageRoot, packageName, version, true);
      return { temporaryRoot, packageRoot, resolution, plugin };
    } catch (error) {
      await this.fileSystem.rm(temporaryRoot).catch(() => undefined);
      throw error;
    }
  }

  private async commitNpmPackage(
    staged: StagedNpmPackage,
    receivedPlan: PluginInstallPlan,
  ): Promise<PluginRegistration> {
    const container = this.packageContainer(receivedPlan.pluginId);
    const target = path.join(container, installationDirectoryName(receivedPlan));
    try {
      return await this.withLifecycleLock(receivedPlan.pluginId, async () => {
        await this.fileSystem.mkdir(container);
        await this.fileSystem.rename(staged.packageRoot, target);
        try {
          return await this.registry.transact(receivedPlan.pluginId, (current) => {
            const expected = createInstallPlan({
              source: "npm",
              plugin: staged.plugin,
              integrity: staged.resolution.integrity,
              previous: current ?? undefined,
            });
            if (!isMatchingPlan(expected, receivedPlan)) {
              throw pluginError("INSTALL_PLAN_MISMATCH", receivedPlan.pluginId);
            }
            const registration = this.createRegistration(expected, target, current ?? undefined);
            return { next: registration, result: registration };
          });
        } catch (error) {
          await this.fileSystem.rm(target).catch(() => undefined);
          await this.removeContainerIfEmpty(container);
          throw error;
        }
      });
    } catch (error) {
      await this.fileSystem.rm(target).catch(() => undefined);
      if (error instanceof PluginRuntimeError) throw error;
      throw pluginError("INSTALL_FAILED", receivedPlan.pluginId, error);
    }
  }

  private createRegistration(
    plan: PluginInstallPlan,
    installPath: string,
    previous?: PluginRegistration,
  ): PluginRegistration {
    const timestamp = this.now().toISOString();
    const priorConfirmationValid = Boolean(previous?.permissionConfirmation
      && plan.permissions.added.length === 0
      && previous.permissionConfirmation.permissions.every((permission) => plan.permissions.requested.includes(permission)));
    const permissionConfirmation = priorConfirmationValid
      ? {
          permissions: [...plan.permissions.requested],
          planDigest: previous!.permissionConfirmation!.planDigest,
          confirmedAt: previous!.permissionConfirmation!.confirmedAt,
        }
      : null;
    return {
      id: plan.pluginId,
      version: plan.toVersion,
      integrity: plan.integrity,
      source: plan.source,
      installPath,
      manifest: plan.manifest,
      permissions: [...plan.permissions.requested],
      activationPlanDigest: plan.planDigest,
      permissionConfirmation,
      enabled: Boolean(previous?.enabled && permissionConfirmation),
      installedAt: previous?.installedAt ?? timestamp,
      updatedAt: timestamp,
    };
  }

  private validate(
    packageRoot: string,
    expectedName?: string,
    expectedVersion?: string,
    requireDependenciesInsidePackage = false,
  ) {
    return validatePluginPackage({
      fileSystem: this.fileSystem,
      packageRoot,
      towerVersion: this.towerVersion,
      nodeVersion: this.nodeVersion,
      expectedName,
      expectedVersion,
      requireDependenciesInsidePackage,
    });
  }

  private localIntegrity(plugin: ValidatedPluginPackage): string {
    return sha256(stableJson({
      packageName: plugin.packageName,
      packageVersion: plugin.packageVersion,
      manifest: plugin.manifestSummary,
    }));
  }

  private async resolveRegisteredRoot(registration: PluginRegistration): Promise<string> {
    try {
      const root = await this.fileSystem.realpath(registration.installPath);
      if (registration.source === "npm") {
        const packagesRoot = await this.fileSystem.realpath(this.registry.packagesDir);
        if (!isPathInside(packagesRoot, root)) throw pluginError("ENTRY_ESCAPE", registration.id);
      }
      return root;
    } catch (error) {
      throw pluginError("PLUGIN_CORRUPT", registration.id, error);
    }
  }

  private sameRegistration(left: PluginRegistration, right: PluginRegistration): boolean {
    return left.id === right.id
      && left.source === right.source
      && left.version === right.version
      && left.integrity === right.integrity
      && left.installPath === right.installPath
      && left.activationPlanDigest === right.activationPlanDigest;
  }

  private packageContainer(pluginId: string): string {
    return path.join(this.registry.packagesDir, packageDirectoryName(pluginId));
  }

  private async withLifecycleLock<T>(pluginId: string, operation: () => Promise<T>): Promise<T> {
    const lockPath = path.join(this.registry.baseDir, ".locks", `${packageDirectoryName(pluginId)}.lock`);
    const release = await this.fileSystem.acquireLock(lockPath);
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  private async removeContainerIfEmpty(container: string): Promise<void> {
    try {
      if ((await this.fileSystem.readdir(container)).length === 0) await this.fileSystem.rm(container);
    } catch {
      // Another failure path reports the original installation error.
    }
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await this.fileSystem.access(target);
      return true;
    } catch {
      return false;
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
