import { createHash } from "node:crypto";
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
        const previous = await this.registry.get(plan.pluginId) ?? undefined;
        const expected = createInstallPlan({
          source: "npm",
          plugin: staged.plugin,
          integrity: staged.resolution.integrity,
          previous,
        });
        if (!isMatchingPlan(expected, plan)) throw pluginError("INSTALL_PLAN_MISMATCH", plan.pluginId);
        return await this.commitNpmPackage(staged, expected, previous);
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
      const previous = await this.registry.get(plan.pluginId) ?? undefined;
      const expected = createInstallPlan({
        source: "local",
        sourcePath: packageRoot,
        plugin,
        integrity: this.localIntegrity(plugin),
        previous,
      });
      if (!isMatchingPlan(expected, plan)) throw pluginError("INSTALL_PLAN_MISMATCH", plan.pluginId);
      const registration = this.createRegistration(expected, packageRoot, previous);
      await this.registry.set(registration);
      await this.removePreviousNpmInstall(previous, packageRoot);
      return registration;
    });
  }

  async confirmAndEnable(pluginId: string, plan: PluginInstallPlan): Promise<PluginRegistration> {
    return this.serialized(async () => {
      const registration = await this.registry.get(pluginId);
      if (!registration) throw pluginError("PLUGIN_NOT_FOUND", pluginId);
      if (plan.pluginId !== pluginId
        || plan.planDigest !== registration.activationPlanDigest
        || !isMatchingPlan(plan, plan)
        || plan.toVersion !== registration.version
        || plan.integrity !== registration.integrity
        || plan.manifest.digest !== registration.manifest.digest
        || !sameStringSet(plan.permissions.requested, registration.permissions)) {
        throw pluginError("INSTALL_PLAN_MISMATCH", pluginId);
      }
      const confirmedAt = this.now().toISOString();
      return this.registry.update(pluginId, (current) => ({
        ...current,
        enabled: true,
        permissionConfirmation: {
          permissions: [...current.permissions].sort(),
          planDigest: plan.planDigest,
          confirmedAt,
        },
        updatedAt: confirmedAt,
      }));
    });
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
      const registration = await this.registry.get(pluginId);
      if (!registration) throw pluginError("PLUGIN_NOT_FOUND", pluginId);
      if (registration.source === "local") {
        await this.registry.remove(pluginId);
        await this.fileSystem.rm(this.packageContainer(pluginId)).catch(() => undefined);
        return;
      }
      const installPath = path.resolve(registration.installPath);
      const container = this.packageContainer(pluginId);
      if (!isPathInside(container, installPath)) {
        throw pluginError("UNINSTALL_FAILED", pluginId);
      }
      const trash = path.join(this.registry.stagingDir, `.uninstall-${packageDirectoryName(pluginId)}-${Date.now()}`);
      const exists = await this.exists(container);
      try {
        if (exists) await this.fileSystem.rename(container, trash);
        await this.registry.remove(pluginId);
        if (exists) await this.fileSystem.rm(trash).catch(() => undefined);
      } catch (error) {
        if (exists && await this.exists(trash)) await this.fileSystem.rename(trash, container).catch(() => undefined);
        throw pluginError("UNINSTALL_FAILED", pluginId, error);
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
    plan: PluginInstallPlan,
    previous?: PluginRegistration,
  ): Promise<PluginRegistration> {
    const container = this.packageContainer(plan.pluginId);
    const target = path.join(container, installationDirectoryName(plan));
    try {
      await this.fileSystem.mkdir(container);
      await this.fileSystem.rename(staged.packageRoot, target);
      const registration = this.createRegistration(plan, target, previous);
      await this.registry.set(registration);
      return registration;
    } catch (error) {
      await this.fileSystem.rm(target).catch(() => undefined);
      throw pluginError("INSTALL_FAILED", plan.pluginId, error);
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

  private async removePreviousNpmInstall(previous: PluginRegistration | undefined, currentPath: string): Promise<void> {
    // Immutable npm installs are intentionally retained until uninstall so a
    // concurrent loader that already read the old registration never loses its files.
    void previous;
    void currentPath;
  }

  private packageContainer(pluginId: string): string {
    return path.join(this.registry.packagesDir, packageDirectoryName(pluginId));
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
