export type PluginRuntimeErrorCode =
  | "INVALID_PACKAGE_NAME"
  | "INVALID_PACKAGE_VERSION"
  | "PACKAGE_NOT_FOUND"
  | "INTEGRITY_MISMATCH"
  | "UNSAFE_ARCHIVE"
  | "INSTALL_FAILED"
  | "INVALID_PACKAGE"
  | "INVALID_MANIFEST"
  | "INVALID_CONFIG_SCHEMA"
  | "INCOMPATIBLE_PLUGIN"
  | "ENTRY_ESCAPE"
  | "NATIVE_MODULE_REJECTED"
  | "DEPENDENCY_UNAVAILABLE"
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

  constructor(
    code: PluginRuntimeErrorCode,
    message: string,
    options: { pluginId?: string } = {},
  ) {
    super(message);
    this.name = "PluginRuntimeError";
    this.code = code;
    this.pluginId = options.pluginId;
  }
}

export function pluginError(
  code: PluginRuntimeErrorCode,
  pluginId?: string,
  cause?: unknown,
): PluginRuntimeError {
  void cause;
  const messages: Record<PluginRuntimeErrorCode, string> = {
    INVALID_PACKAGE_NAME: "Invalid npm package name",
    INVALID_PACKAGE_VERSION: "An exact SemVer package version is required",
    PACKAGE_NOT_FOUND: "Plugin package could not be resolved",
    INTEGRITY_MISMATCH: "Plugin package integrity verification failed",
    UNSAFE_ARCHIVE: "Plugin package archive is unsafe",
    INSTALL_FAILED: "Plugin installation failed",
    INVALID_PACKAGE: "Plugin package metadata is invalid",
    INVALID_MANIFEST: "Plugin manifest is invalid",
    INVALID_CONFIG_SCHEMA: "Plugin configuration schema is invalid",
    INCOMPATIBLE_PLUGIN: "Plugin is incompatible with this Tower runtime",
    ENTRY_ESCAPE: "Plugin entry is outside its package",
    NATIVE_MODULE_REJECTED: "Native Node.js modules are not allowed in plugins",
    DEPENDENCY_UNAVAILABLE: "A plugin production dependency is unavailable",
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
  return new PluginRuntimeError(code, messages[code], { pluginId });
}
