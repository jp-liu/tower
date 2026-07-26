export type PluginRuntimeErrorCode =
  | "INVALID_PACKAGE_NAME"
  | "INVALID_PACKAGE_VERSION"
  | "PACKAGE_NOT_FOUND"
  | "CATALOG_INVALID"
  | "CATALOG_UNAVAILABLE"
  | "CATALOG_ENTRY_NOT_FOUND"
  | "ARTIFACT_INVALID"
  | "ARTIFACT_DOWNLOAD_FAILED"
  | "ARTIFACT_SIZE_MISMATCH"
  | "INTEGRITY_MISMATCH"
  | "UNSAFE_ARCHIVE"
  | "INSTALL_FAILED"
  | "INVALID_PACKAGE"
  | "INVALID_MANIFEST"
  | "MANIFEST_MIGRATION_REQUIRED"
  | "INVALID_CONFIG_SCHEMA"
  | "INCOMPATIBLE_PLUGIN"
  | "ENTRY_ESCAPE"
  | "NATIVE_MODULE_REJECTED"
  | "DEPENDENCY_UNAVAILABLE"
  | "CLI_DEPENDENCY_UNAVAILABLE"
  | "REGISTRY_CORRUPT"
  | "PLUGIN_NOT_FOUND"
  | "PLUGIN_DISABLED"
  | "PERMISSION_CONFIRMATION_REQUIRED"
  | "INSTALL_PLAN_MISMATCH"
  | "PLUGIN_CORRUPT"
  | "INVALID_PLUGIN_EXPORT"
  | "INVALID_ADAPTER"
  | "UNINSTALL_FAILED";

export class PluginRuntimeError extends Error {
  readonly code: PluginRuntimeErrorCode;
  readonly pluginId?: string;
  readonly diagnostic?: unknown;

  constructor(
    code: PluginRuntimeErrorCode,
    message: string,
    options: { pluginId?: string; diagnostic?: unknown } = {},
  ) {
    super(message);
    this.name = "PluginRuntimeError";
    this.code = code;
    this.pluginId = options.pluginId;
    this.diagnostic = options.diagnostic;
  }
}

export function pluginError(
  code: PluginRuntimeErrorCode,
  pluginId?: string,
  cause?: unknown,
  diagnostic?: unknown,
): PluginRuntimeError {
  void cause;
  const messages: Record<PluginRuntimeErrorCode, string> = {
    INVALID_PACKAGE_NAME: "Invalid npm package name",
    INVALID_PACKAGE_VERSION: "An exact SemVer package version is required",
    PACKAGE_NOT_FOUND: "Plugin package could not be resolved",
    CATALOG_INVALID: "Extension catalog is invalid",
    CATALOG_UNAVAILABLE: "Extension catalog is unavailable",
    CATALOG_ENTRY_NOT_FOUND: "Extension version was not found in the catalog",
    ARTIFACT_INVALID: "Extension artifact metadata is invalid",
    ARTIFACT_DOWNLOAD_FAILED: "Extension artifact download failed",
    ARTIFACT_SIZE_MISMATCH: "Extension artifact size verification failed",
    INTEGRITY_MISMATCH: "Plugin package integrity verification failed",
    UNSAFE_ARCHIVE: "Plugin package archive is unsafe",
    INSTALL_FAILED: "Plugin installation failed",
    INVALID_PACKAGE: "Plugin package metadata is invalid",
    INVALID_MANIFEST: "Plugin manifest is invalid",
    MANIFEST_MIGRATION_REQUIRED: "Plugin manifest uses the pre-Catalog v1 shape and must be migrated",
    INVALID_CONFIG_SCHEMA: "Plugin configuration schema is invalid",
    INCOMPATIBLE_PLUGIN: "Plugin is incompatible with this Tower runtime",
    ENTRY_ESCAPE: "Plugin entry is outside its package",
    NATIVE_MODULE_REJECTED: "Native Node.js modules are not allowed in plugins",
    DEPENDENCY_UNAVAILABLE: "A plugin production dependency is unavailable",
    CLI_DEPENDENCY_UNAVAILABLE: "The required third-party CLI is unavailable or incompatible",
    REGISTRY_CORRUPT: "Plugin registry is corrupt",
    PLUGIN_NOT_FOUND: "Plugin is not registered",
    PLUGIN_DISABLED: "Plugin is disabled",
    PERMISSION_CONFIRMATION_REQUIRED: "Plugin permissions have not been confirmed",
    INSTALL_PLAN_MISMATCH: "Plugin installation plan does not match the current package",
    PLUGIN_CORRUPT: "Installed plugin files do not match the registry",
    INVALID_PLUGIN_EXPORT: "Plugin module does not expose the standard CLI provider export",
    INVALID_ADAPTER: "Plugin returned an invalid CLI adapter",
    UNINSTALL_FAILED: "Plugin uninstall failed",
  };
  return new PluginRuntimeError(code, messages[code], { pluginId, diagnostic });
}
