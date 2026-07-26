import type { CliConfigSchema, CliPluginManifestV1, CliPluginPermission } from "@tower/ai-sdk";
import type { CatalogArtifact, CatalogPublisher } from "./catalog.js";
import type { CliDependencyDiagnostic } from "./cli-dependency.js";

export const PLUGIN_REGISTRY_VERSION = 2 as const;
export const PLUGIN_INSTALL_PLAN_VERSION = 1 as const;

export type PluginSource = "catalog" | "development" | "npm" | "local" | "legacy";

export interface PluginManifestSummary {
  digest: string;
  entryDigest: string;
  configSchemaDigest: string;
  /** Sorted directory/file paths and file bytes; filesystem modes are intentionally excluded. */
  packageTreeDigest?: string;
  manifestVersion: number;
  apiVersion: string;
  kind: "cli-provider";
  displayName: string;
  extensionId?: string;
  publisherId?: string;
}

export interface PluginPermissionConfirmation {
  permissions: CliPluginPermission[];
  planDigest: string;
  confirmedAt: string;
}

export interface PluginRegistration {
  id: string;
  version: string;
  integrity: string;
  source: PluginSource;
  sourceLocator?: string;
  installPath: string;
  manifest: PluginManifestSummary;
  permissions: CliPluginPermission[];
  activationPlanDigest: string;
  permissionConfirmation: PluginPermissionConfirmation | null;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
}

export interface PluginRegistryData {
  version: typeof PLUGIN_REGISTRY_VERSION;
  plugins: Record<string, PluginRegistration>;
}

export interface PluginPermissionDiff {
  requested: CliPluginPermission[];
  added: CliPluginPermission[];
  removed: CliPluginPermission[];
}

export interface PluginInstallPlan {
  version: typeof PLUGIN_INSTALL_PLAN_VERSION;
  operation: "install" | "upgrade" | "register-local";
  pluginId: string;
  source: PluginSource;
  sourcePath?: string;
  packageName?: string;
  catalog?: {
    publisher: CatalogPublisher;
    artifact: CatalogArtifact;
  };
  fromVersion: string | null;
  fromActivationPlanDigest: string | null;
  toVersion: string;
  integrity: string;
  manifest: PluginManifestSummary;
  manifestData: CliPluginManifestV1;
  permissions: PluginPermissionDiff;
  dependency?: CliDependencyDiagnostic;
  planDigest: string;
}

export interface ValidatedPluginPackage {
  packageRoot: string;
  packageName: string;
  packageVersion: string;
  extensionId: string;
  entryPath: string;
  configSchemaPath: string;
  manifest: CliPluginManifestV1;
  manifestSummary: PluginManifestSummary;
}

export interface RegistryRecoveryResult {
  recovered: boolean;
  backupFileName?: string;
}

export interface InspectedPluginPackage {
  manifest: CliPluginManifestV1;
  configSchema: CliConfigSchema;
}
