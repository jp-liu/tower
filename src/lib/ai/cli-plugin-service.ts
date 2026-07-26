import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CliPluginRuntime,
  StaticHttpExtensionCatalog,
  latestCatalogVersion,
  validatePluginSettings,
  type CatalogExtensionVersion,
  type CliDependencyDiagnostic,
  type ExtensionCatalog,
  type PluginInstallPlan,
  type PluginRegistration,
  type PluginRuntimeErrorCode,
} from "@tower/ai-runtime";
import type { CliConfigSchema, CliPluginManifestV1, CliPluginPermission } from "@tower/ai-sdk";
import { db } from "@/lib/db";
import { getTowerDir } from "@/lib/tower-dir";
import { getPackageRoot } from "@/lib/tower-paths";
import { CLI_SECRET_MASK, type CliPluginSecretReference } from "./cli-plugin-shared";

const PLAN_TTL_MS = 10 * 60 * 1_000;
const SENSITIVE_NAME = /(authorization|token|key|secret|password|passwd|credential|cookie)/i;
const BUILT_IN_PLUGIN_IDS = new Set(["claude", "codex", "gemini"]);

export type CliPluginApplicationErrorCode =
  | "invalid_input"
  | "catalog_unavailable"
  | "catalog_invalid"
  | "catalog_entry_not_found"
  | "package_not_found"
  | "plugin_incompatible"
  | "plugin_not_found"
  | "plugin_disabled"
  | "plugin_corrupt"
  | "cli_not_found"
  | "cli_not_executable"
  | "cli_incompatible"
  | "probe_failed"
  | "permission_required"
  | "plan_expired"
  | "plan_mismatch"
  | "registry_corrupt"
  | "operation_failed";

const SAFE_ERROR_MESSAGES: Record<CliPluginApplicationErrorCode, string> = {
  invalid_input: "The plugin request is invalid",
  catalog_unavailable: "The extension catalog is not configured or unavailable",
  catalog_invalid: "The extension catalog is invalid",
  catalog_entry_not_found: "The extension version is no longer available",
  package_not_found: "The plugin package could not be resolved",
  plugin_incompatible: "The plugin is not compatible with this Tower instance",
  plugin_not_found: "The plugin is not installed",
  plugin_disabled: "The plugin is disabled",
  plugin_corrupt: "The installed plugin is damaged or no longer matches its registration",
  cli_not_found: "The plugin CLI command could not be found",
  cli_not_executable: "The plugin CLI command is not runnable",
  cli_incompatible: "The plugin CLI version is not compatible with this provider",
  probe_failed: "The plugin CLI Hello probe failed",
  permission_required: "The plugin permissions must be confirmed",
  plan_expired: "The plugin plan expired; create a new plan",
  plan_mismatch: "The plugin plan no longer matches the package or registration",
  registry_corrupt: "The plugin registry is damaged and must be recovered",
  operation_failed: "The plugin operation could not be completed",
};

export class CliPluginApplicationError extends Error {
  constructor(
    public readonly code: CliPluginApplicationErrorCode,
    public readonly diagnostic?: CliDependencyDiagnostic,
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "CliPluginApplicationError";
  }
}

export function isCliPluginApplicationError(
  error: unknown,
): error is Pick<CliPluginApplicationError, "code" | "diagnostic"> {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    && Object.hasOwn(SAFE_ERROR_MESSAGES, error.code);
}

export interface SafeCliPluginPlan {
  planDigest: string;
  expiresAt: string;
  operation: PluginInstallPlan["operation"];
  pluginId: string;
  source: PluginInstallPlan["source"];
  fromVersion: string | null;
  toVersion: string;
  displayName: string;
  description: string | null;
  publisher: { id: string; name: string };
  cliDependency: {
    name: string;
    command: string;
    supportedVersions: string;
    homepage: string;
    installDocs: string;
    managedByTower: false;
  };
  dependency: CliDependencyDiagnostic | null;
  compatibility: CliPluginManifestV1["compatibility"];
  capabilities: CliPluginManifestV1["capabilities"];
  permissions: {
    requested: CliPluginPermission[];
    added: CliPluginPermission[];
    removed: CliPluginPermission[];
  };
}

export interface CliPluginListItem {
  id: string;
  version: string;
  source: PluginRegistration["source"];
  enabled: boolean;
  displayName: string;
  permissions: CliPluginPermission[];
  permissionConfirmed: boolean;
  installedAt: string;
  updatedAt: string;
  health: "ready" | "disabled" | "corrupt" | "dependency-missing" | "dependency-incompatible" | "probe-failed";
  dependency: CliDependencyDiagnostic | null;
  capabilities: CliPluginManifestV1["capabilities"] | null;
}

export interface CliProviderCatalogItem {
  id: string;
  kind: "cli-provider";
  publisher: { id: string; name: string };
  display: { name: string; description: string | null; homepage: string | null };
  latestVersion: string;
  versions: Array<{
    version: string;
    cliDependency: CatalogExtensionVersion["cliDependency"] | null;
  }>;
  installed: CliPluginListItem | null;
  updateAvailable: boolean;
}

export interface CliEnvironmentVariable {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  sensitive: boolean;
}

export interface CliPluginConnectionDetail {
  id: string;
  pluginId: string;
  name: string;
  enabled: boolean;
  commandOverride: string | null;
  baseArgs: string[];
  envVars: CliEnvironmentVariable[];
  settings: Record<string, unknown>;
  configSchema: CliConfigSchema;
  resolvedCommand: string | null;
  resolvedVersion: string | null;
  testStatus: string;
  testOk: boolean;
  models: string[];
}

interface PendingPlan {
  plan: PluginInstallPlan;
  expiresAt: number;
  installed: boolean;
}

interface CliPluginApplicationOptions {
  runtime: CliPluginRuntime;
  dataRoot: string;
  database?: typeof db;
  now?: () => number;
  pendingPlans?: Map<string, PendingPlan>;
  catalog?: ExtensionCatalog | null;
  catalogFactory?: () => Promise<ExtensionCatalog | null>;
}

function towerVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(getPackageRoot(), "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function mapRuntimeError(error: unknown): never {
  if (isCliPluginApplicationError(error)) {
    throw new CliPluginApplicationError(error.code, error.diagnostic);
  }
  const runtimeError = typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string"
    ? error as { code: PluginRuntimeErrorCode; diagnostic?: unknown }
    : null;
  if (!runtimeError) throw new CliPluginApplicationError("operation_failed");
  if (runtimeError.code === "CATALOG_UNAVAILABLE") throw new CliPluginApplicationError("catalog_unavailable");
  if (runtimeError.code === "CATALOG_INVALID") throw new CliPluginApplicationError("catalog_invalid");
  if (runtimeError.code === "CATALOG_ENTRY_NOT_FOUND") throw new CliPluginApplicationError("catalog_entry_not_found");
  if (runtimeError.code === "INVALID_PACKAGE_NAME"
    || runtimeError.code === "INVALID_PACKAGE_VERSION"
    || runtimeError.code === "INVALID_PACKAGE"
    || runtimeError.code === "INVALID_MANIFEST"
    || runtimeError.code === "INVALID_CONFIG_SCHEMA"
    || runtimeError.code === "ENTRY_ESCAPE"
    || runtimeError.code === "NATIVE_MODULE_REJECTED"
    || runtimeError.code === "DEPENDENCY_UNAVAILABLE"
    || runtimeError.code === "UNSAFE_ARCHIVE") {
    throw new CliPluginApplicationError("invalid_input");
  }
  if (runtimeError.code === "PACKAGE_NOT_FOUND") throw new CliPluginApplicationError("package_not_found");
  if (runtimeError.code === "INCOMPATIBLE_PLUGIN") throw new CliPluginApplicationError("plugin_incompatible");
  if (runtimeError.code === "PLUGIN_NOT_FOUND") throw new CliPluginApplicationError("plugin_not_found");
  if (runtimeError.code === "PLUGIN_DISABLED") throw new CliPluginApplicationError("plugin_disabled");
  if (runtimeError.code === "PLUGIN_CORRUPT"
    || runtimeError.code === "INTEGRITY_MISMATCH"
    || runtimeError.code === "INVALID_PLUGIN_EXPORT"
    || runtimeError.code === "INVALID_ADAPTER") {
    throw new CliPluginApplicationError("plugin_corrupt");
  }
  if (runtimeError.code === "PERMISSION_CONFIRMATION_REQUIRED") {
    throw new CliPluginApplicationError("permission_required");
  }
  if (runtimeError.code === "CLI_DEPENDENCY_UNAVAILABLE") {
    const diagnostic = runtimeError.diagnostic as CliDependencyDiagnostic | undefined;
    if (diagnostic?.state === "missing") throw new CliPluginApplicationError("cli_not_found", diagnostic);
    if (diagnostic?.state === "version-incompatible") {
      throw new CliPluginApplicationError("cli_incompatible", diagnostic);
    }
    throw new CliPluginApplicationError("probe_failed", diagnostic);
  }
  if (runtimeError.code === "INSTALL_PLAN_MISMATCH") throw new CliPluginApplicationError("plan_mismatch");
  if (runtimeError.code === "REGISTRY_CORRUPT") throw new CliPluginApplicationError("registry_corrupt");
  throw new CliPluginApplicationError("operation_failed");
}

function safePlan(plan: PluginInstallPlan, expiresAt: number): SafeCliPluginPlan {
  return {
    planDigest: plan.planDigest,
    expiresAt: new Date(expiresAt).toISOString(),
    operation: plan.operation,
    pluginId: plan.pluginId,
    source: plan.source,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    displayName: plan.manifestData.display.name,
    description: plan.manifestData.display.description ?? null,
    publisher: structuredClone(plan.catalog?.publisher ?? plan.manifestData.publisher),
    cliDependency: {
      ...structuredClone(plan.manifestData.cliDependency),
      command: plan.manifestData.command.default,
    },
    dependency: plan.dependency ? structuredClone(plan.dependency) : null,
    compatibility: structuredClone(plan.manifestData.compatibility),
    capabilities: structuredClone(plan.manifestData.capabilities),
    permissions: structuredClone(plan.permissions),
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function hasCurrentPermissionConfirmation(registration: PluginRegistration): boolean {
  const confirmation = registration.permissionConfirmation;
  return Boolean(confirmation
    && confirmation.planDigest === registration.activationPlanDigest
    && confirmation.permissions.length === registration.permissions.length
    && registration.permissions.every((permission) => confirmation.permissions.includes(permission)));
}

function maskedSettings(schema: CliConfigSchema, settings: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(settings).map(([key, value]) => [
    key,
    schema.properties?.[key]?.["x-tower"]?.sensitive === true ? CLI_SECRET_MASK : value,
  ]));
}

export class CliPluginApplication {
  readonly runtime: CliPluginRuntime;
  readonly dataRoot: string;
  private readonly database: typeof db;
  private readonly now: () => number;
  private readonly pendingPlans: Map<string, PendingPlan>;
  private readonly catalogFactory: () => Promise<ExtensionCatalog | null>;

  constructor(options: CliPluginApplicationOptions) {
    this.runtime = options.runtime;
    this.dataRoot = options.dataRoot;
    this.database = options.database ?? db;
    this.now = options.now ?? Date.now;
    this.pendingPlans = options.pendingPlans ?? new Map();
    this.catalogFactory = options.catalogFactory ?? (async () => options.catalog ?? null);
  }

  async list(): Promise<CliPluginListItem[]> {
    let registrations: PluginRegistration[];
    try {
      registrations = await this.runtime.list();
    } catch (error) {
      return mapRuntimeError(error);
    }
    return Promise.all(registrations.map(async (registration) => {
      try {
        const dependency = await this.runtime.recheck(registration.id);
        const inspected = await this.runtime.inspect(registration.id);
        const health = dependency.state === "missing"
          ? "dependency-missing" as const
          : dependency.state === "version-incompatible"
            ? "dependency-incompatible" as const
            : dependency.state === "probe-failed"
              ? "probe-failed" as const
              : registration.enabled ? "ready" as const : "disabled" as const;
        return {
          id: registration.id,
          version: registration.version,
          source: registration.source,
          enabled: registration.enabled,
          displayName: inspected.manifest.display.name,
          permissions: [...registration.permissions],
          permissionConfirmed: hasCurrentPermissionConfirmation(registration),
          installedAt: registration.installedAt,
          updatedAt: registration.updatedAt,
          health,
          dependency,
          capabilities: structuredClone(inspected.manifest.capabilities),
        };
      } catch {
        return {
          id: registration.id,
          version: registration.version,
          source: registration.source,
          enabled: registration.enabled,
          displayName: registration.manifest.displayName,
          permissions: [...registration.permissions],
          permissionConfirmed: hasCurrentPermissionConfirmation(registration),
          installedAt: registration.installedAt,
          updatedAt: registration.updatedAt,
          health: "corrupt" as const,
          dependency: null,
          capabilities: null,
        };
      }
    }));
  }

  async listCatalog(search = ""): Promise<CliProviderCatalogItem[]> {
    try {
      const catalog = await this.requireCatalog();
      const [index, installed] = await Promise.all([
        this.runtime.readCatalog(catalog),
        this.list(),
      ]);
      const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]));
      const query = search.trim().toLocaleLowerCase();
      return index.extensions
        .filter((extension) => {
          if (!query) return true;
          const dependencyNames = extension.versions
            .map((release) => release.cliDependency?.name ?? "")
            .join(" ");
          return [
            extension.id,
            extension.display.name,
            extension.display.description ?? "",
            extension.publisher.id,
            extension.publisher.name,
            dependencyNames,
          ].join(" ").toLocaleLowerCase().includes(query);
        })
        .map((extension) => {
          const latest = latestCatalogVersion(extension);
          const current = installedById.get(extension.id) ?? null;
          return {
            id: extension.id,
            kind: extension.kind,
            publisher: structuredClone(extension.publisher),
            display: {
              name: extension.display.name,
              description: extension.display.description ?? null,
              homepage: extension.display.homepage ?? null,
            },
            latestVersion: latest.version,
            versions: [...extension.versions]
              .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))
              .map((release) => ({
                version: release.version,
                cliDependency: release.cliDependency ? structuredClone(release.cliDependency) : null,
              })),
            installed: current,
            updateAvailable: Boolean(current && current.version !== latest.version),
          };
        })
        .sort((left, right) => left.display.name.localeCompare(right.display.name));
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async planCatalog(extensionId: string, version: string): Promise<SafeCliPluginPlan> {
    if (BUILT_IN_PLUGIN_IDS.has(extensionId)) throw new CliPluginApplicationError("invalid_input");
    try {
      return this.rememberPlan(await this.runtime.planCatalogInstall(
        await this.requireCatalog(),
        extensionId,
        version,
      ));
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async planNpm(packageName: string, version: string): Promise<SafeCliPluginPlan> {
    if (BUILT_IN_PLUGIN_IDS.has(packageName)) throw new CliPluginApplicationError("invalid_input");
    try {
      return this.rememberPlan(await this.runtime.planNpmInstall(packageName, version));
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async planLocal(directory: string): Promise<SafeCliPluginPlan> {
    try {
      const plan = await this.runtime.planLocalRegistration(directory);
      if (BUILT_IN_PLUGIN_IDS.has(plan.pluginId)) throw new CliPluginApplicationError("invalid_input");
      return this.rememberPlan(plan);
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async reviewInstalled(pluginId: string): Promise<SafeCliPluginPlan> {
    try {
      const registration = await this.runtime.get(pluginId);
      if (!registration || registration.enabled) {
        throw new CliPluginApplicationError(registration ? "invalid_input" : "plugin_not_found");
      }
      const plan = registration.source === "catalog"
        ? await this.runtime.planCatalogInstall(await this.requireCatalog(), registration.id, registration.version)
        : registration.source === "npm"
          ? await this.runtime.planNpmInstall(registration.id, registration.version)
          : await this.runtime.planLocalRegistration(registration.installPath);
      if (plan.pluginId !== registration.id) throw new CliPluginApplicationError("plan_mismatch");
      return this.rememberPlan(plan);
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async install(planDigest: string): Promise<CliPluginListItem> {
    const pending = this.requirePlan(planDigest, false);
    try {
      const registration = pending.plan.source === "catalog"
        ? await this.runtime.installCatalog(pending.plan)
        : pending.plan.source === "npm"
          ? await this.runtime.installNpm(pending.plan)
          : await this.runtime.registerLocal(pending.plan);
      pending.installed = true;
      await this.database.providerConnection.upsert({
        where: { connectionKey: `cli:${registration.id}` },
        create: {
          connectionKey: `cli:${registration.id}`,
          name: pending.plan.manifestData.display.name,
          kind: "cli",
          provider: registration.id,
          enabled: false,
          testStatus: "untested",
          testOk: false,
        },
        update: {
          enabled: false,
          testStatus: "untested",
          testOk: false,
          resolvedCommand: null,
          resolvedVersion: null,
          diagnosticsJson: JSON.stringify({ code: "permission_required" }),
        },
      });
      return (await this.list()).find((item) => item.id === registration.id)!;
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async confirmAndEnable(planDigest: string): Promise<CliPluginListItem> {
    const pending = this.requirePlan(planDigest, true);
    try {
      await this.assertDependencyReady(pending.plan.pluginId);
      const registration = await this.runtime.confirmAndEnable(pending.plan.pluginId, pending.plan);
      await this.database.providerConnection.upsert({
        where: { connectionKey: `cli:${registration.id}` },
        create: {
          connectionKey: `cli:${registration.id}`,
          name: pending.plan.manifestData.display.name,
          kind: "cli",
          provider: registration.id,
          enabled: true,
          testStatus: "untested",
          testOk: false,
        },
        update: {
          enabled: true,
          testStatus: "untested",
          testOk: false,
          diagnosticsJson: null,
        },
      });
      this.pendingPlans.delete(planDigest);
      return (await this.list()).find((item) => item.id === registration.id)!;
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async disable(pluginId: string): Promise<void> {
    try {
      await this.runtime.disable(pluginId);
      await this.database.providerConnection.updateMany({
        where: { connectionKey: `cli:${pluginId}`, kind: "cli" },
        data: {
          enabled: false,
          testStatus: "unavailable",
          testOk: false,
          diagnosticsJson: JSON.stringify({ code: "plugin_disabled" }),
        },
      });
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async enable(pluginId: string): Promise<CliPluginListItem> {
    try {
      await this.assertDependencyReady(pluginId);
      const registration = await this.runtime.enable(pluginId);
      await this.database.providerConnection.updateMany({
        where: { connectionKey: `cli:${pluginId}`, kind: "cli" },
        data: {
          enabled: true,
          testStatus: "untested",
          testOk: false,
          diagnosticsJson: null,
        },
      });
      return (await this.list()).find((item) => item.id === registration.id)!;
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async uninstall(pluginId: string): Promise<void> {
    try {
      await this.runtime.uninstall(pluginId);
      await this.database.providerConnection.updateMany({
        where: { connectionKey: `cli:${pluginId}`, kind: "cli" },
        data: {
          enabled: false,
          testStatus: "unavailable",
          testOk: false,
          resolvedCommand: null,
          resolvedVersion: null,
          diagnosticsJson: JSON.stringify({ code: "plugin_not_found" }),
        },
      });
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async recoverRegistry(): Promise<{ recovered: boolean; backupCreated: boolean }> {
    try {
      const result = await this.runtime.recoverRegistry();
      return { recovered: result.recovered, backupCreated: Boolean(result.backupFileName) };
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async getConnectionDetail(pluginId: string): Promise<CliPluginConnectionDetail> {
    try {
      const [registration, inspected, connection] = await Promise.all([
        this.runtime.get(pluginId),
        this.runtime.inspect(pluginId),
        this.database.providerConnection.findUnique({
          where: { connectionKey: `cli:${pluginId}` },
          include: { models: { where: { available: true }, orderBy: { modelId: "asc" } } },
        }),
      ]);
      if (!registration || !connection || connection.kind !== "cli") {
        throw new CliPluginApplicationError("plugin_not_found");
      }
      const settings = validatePluginSettings(
        inspected.configSchema,
        parseJson(connection.settingsJson, {}),
        { applyDefaults: true },
      );
      return {
        id: connection.id,
        pluginId,
        name: connection.name,
        enabled: connection.enabled && registration.enabled,
        commandOverride: connection.commandOverride,
        baseArgs: parseJson(connection.baseArgsJson, []),
        envVars: parseJson<CliEnvironmentVariable[]>(connection.envVarsJson, []).map((entry) => ({
          ...entry,
          sensitive: entry.sensitive || SENSITIVE_NAME.test(entry.name),
          value: entry.sensitive || SENSITIVE_NAME.test(entry.name) ? CLI_SECRET_MASK : entry.value,
        })),
        settings: maskedSettings(inspected.configSchema, settings),
        configSchema: structuredClone(inspected.configSchema),
        resolvedCommand: connection.resolvedCommand,
        resolvedVersion: connection.resolvedVersion,
        testStatus: connection.testStatus,
        testOk: connection.testOk,
        models: connection.models.map((model) => model.modelId),
      };
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async saveConnection(input: {
    connectionId: string;
    name: string;
    enabled: boolean;
    commandOverride?: string | null;
    baseArgs: string[];
    envVars: CliEnvironmentVariable[];
    settings: Record<string, unknown>;
  }): Promise<CliPluginConnectionDetail> {
    const connection = await this.database.providerConnection.findUnique({ where: { id: input.connectionId } });
    if (!connection || connection.kind !== "cli") throw new CliPluginApplicationError("plugin_not_found");
    try {
      const inspected = await this.runtime.inspect(connection.provider);
      const storedSettings = parseJson<Record<string, unknown>>(connection.settingsJson, {});
      const unmaskedSettings = Object.fromEntries(Object.entries(input.settings).map(([key, value]) => [
        key,
        value === CLI_SECRET_MASK ? storedSettings[key] : value,
      ]));
      const settingsWithDefaults = validatePluginSettings(inspected.configSchema, unmaskedSettings, {
        applyDefaults: true,
      });
      validatePluginSettings(inspected.configSchema, settingsWithDefaults);
      const storedEnv = new Map(
        parseJson<CliEnvironmentVariable[]>(connection.envVarsJson, []).map((entry) => [entry.id, entry]),
      );
      const envVars = input.envVars.map((entry) => ({
        ...entry,
        value: entry.value === CLI_SECRET_MASK ? storedEnv.get(entry.id)?.value ?? "" : entry.value,
        sensitive: entry.sensitive || SENSITIVE_NAME.test(entry.name),
      }));
      await this.database.providerConnection.update({
        where: { id: connection.id },
        data: {
          name: input.name,
          enabled: input.enabled,
          commandOverride: input.commandOverride?.trim() || null,
          baseArgsJson: JSON.stringify(input.baseArgs),
          envVarsJson: JSON.stringify(envVars),
          settingsJson: JSON.stringify(settingsWithDefaults),
          testStatus: "untested",
          testOk: false,
          resolvedCommand: null,
          resolvedVersion: null,
          diagnosticsJson: null,
        },
      });
      return this.getConnectionDetail(connection.provider);
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  async revealConnectionSecret(
    connectionId: string,
    reference: CliPluginSecretReference,
  ): Promise<{ value: string }> {
    const connection = await this.database.providerConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.kind !== "cli") throw new CliPluginApplicationError("plugin_not_found");
    try {
      if (reference.kind === "environment") {
        const entry = parseJson<CliEnvironmentVariable[]>(connection.envVarsJson, [])
          .find((candidate) => candidate.id === reference.key);
        if (!entry || (!entry.sensitive && !SENSITIVE_NAME.test(entry.name))) {
          throw new CliPluginApplicationError("invalid_input");
        }
        return { value: entry.value };
      }
      const inspected = await this.runtime.inspect(connection.provider);
      if (inspected.configSchema.properties?.[reference.key]?.["x-tower"]?.sensitive !== true) {
        throw new CliPluginApplicationError("invalid_input");
      }
      const value = parseJson<Record<string, unknown>>(connection.settingsJson, {})[reference.key];
      if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
        throw new CliPluginApplicationError("invalid_input");
      }
      return { value: String(value) };
    } catch (error) {
      return mapRuntimeError(error);
    }
  }

  private rememberPlan(plan: PluginInstallPlan): SafeCliPluginPlan {
    const expiresAt = this.now() + PLAN_TTL_MS;
    this.pendingPlans.set(plan.planDigest, { plan, expiresAt, installed: false });
    return safePlan(plan, expiresAt);
  }

  private async requireCatalog(): Promise<ExtensionCatalog> {
    const catalog = await this.catalogFactory();
    if (!catalog) throw new CliPluginApplicationError("catalog_unavailable");
    return catalog;
  }

  private async assertDependencyReady(pluginId: string): Promise<void> {
    const diagnostic = await this.runtime.recheck(pluginId);
    if (diagnostic.state === "ready") return;
    if (diagnostic.state === "missing") throw new CliPluginApplicationError("cli_not_found", diagnostic);
    if (diagnostic.state === "version-incompatible") {
      throw new CliPluginApplicationError("cli_incompatible", diagnostic);
    }
    throw new CliPluginApplicationError("probe_failed", diagnostic);
  }

  private requirePlan(planDigest: string, mustBeInstalled: boolean): PendingPlan {
    const pending = this.pendingPlans.get(planDigest);
    if (!pending || pending.expiresAt <= this.now()) {
      if (pending) this.pendingPlans.delete(planDigest);
      throw new CliPluginApplicationError("plan_expired");
    }
    if (pending.installed !== mustBeInstalled) throw new CliPluginApplicationError("plan_mismatch");
    return pending;
  }
}

interface CliPluginGlobals {
  __towerCliPluginApplications?: Map<string, CliPluginApplication>;
}

export function getCliPluginApplication(): CliPluginApplication {
  const dataRoot = path.resolve(getTowerDir());
  const globals = globalThis as typeof globalThis & CliPluginGlobals;
  const applications = globals.__towerCliPluginApplications ??= new Map();
  const key = `${dataRoot}\0${towerVersion()}`;
  let application = applications.get(key);
  if (!application) {
    application = new CliPluginApplication({
      dataRoot,
      runtime: new CliPluginRuntime({ dataRoot, towerVersion: towerVersion() }),
      catalogFactory: async () => {
        const environmentUrl = process.env.TOWER_EXTENSION_CATALOG_URL?.trim();
        const row = environmentUrl ? null : await db.systemConfig.findUnique({
          where: { key: "extensions.catalogUrl" },
          select: { value: true },
        });
        let configured = environmentUrl;
        if (!configured && row) {
          try {
            const value = JSON.parse(row.value) as unknown;
            configured = typeof value === "string" ? value.trim() : undefined;
          } catch {
            throw new CliPluginApplicationError("catalog_invalid");
          }
        }
        if (!configured) return null;
        try {
          return new StaticHttpExtensionCatalog(configured);
        } catch {
          throw new CliPluginApplicationError("catalog_invalid");
        }
      },
    });
    applications.set(key, application);
  }
  return application;
}

export function isSensitiveConfigName(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}
