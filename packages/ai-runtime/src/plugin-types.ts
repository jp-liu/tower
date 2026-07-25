import type { CliConfigSchema, CliPluginManifestV1, CliPluginPermission } from "@tower/ai-sdk";

export const PLUGIN_REGISTRY_VERSION = 1 as const;
export const PLUGIN_INSTALL_PLAN_VERSION = 1 as const;

export type PluginSource = "npm" | "local";

export interface PluginManifestSummary {
  digest: string;
  entryDigest: string;
  configSchemaDigest: string;
  manifestVersion: number;
  apiVersion: string;
  kind: "cli-provider";
  displayName: string;
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
  fromVersion: string | null;
  fromActivationPlanDigest: string | null;
  toVersion: string;
  integrity: string;
  manifest: PluginManifestSummary;
  manifestData: CliPluginManifestV1;
  permissions: PluginPermissionDiff;
  planDigest: string;
}

export interface ValidatedPluginPackage {
  packageRoot: string;
  packageName: string;
  packageVersion: string;
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
