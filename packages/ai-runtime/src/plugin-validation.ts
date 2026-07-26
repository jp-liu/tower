import { createHash } from "node:crypto";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import semver from "semver";
import {
  CLI_PLUGIN_EXPORT_PATH,
  isCliPluginApiVersionCompatible,
  isCliPluginManifestV1,
  isLegacyCliPluginManifestV1,
  type CliPluginManifestV1,
  type CliPluginPermission,
  type CliConfigSchema,
} from "@tower/ai-sdk";
import { pluginError } from "./plugin-errors.js";
import type { PluginFileSystem } from "./plugin-filesystem.js";
import type {
  PluginInstallPlan,
  PluginManifestSummary,
  PluginPermissionDiff,
  PluginRegistration,
  PluginSource,
  ValidatedPluginPackage,
} from "./plugin-types.js";
import { PLUGIN_INSTALL_PLAN_VERSION } from "./plugin-types.js";

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const CONFIG_SCHEMA_URI = "https://json-schema.org/draft/2020-12/schema";
const TOWER_CONFIG_CONTROLS = new Set([
  "text",
  "number",
  "switch",
  "select",
  "multiselect",
  "path",
  "string-list",
  "key-value",
]);
const TOWER_ANNOTATION_KEYS = new Set(["control", "order", "group", "advanced", "sensitive"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertValidPackageName(packageName: string): void {
  if (packageName.length > 214
    || !PACKAGE_NAME_PATTERN.test(packageName)
    || packageName.includes("..")) {
    throw pluginError("INVALID_PACKAGE_NAME");
  }
}

export function assertExactSemVer(version: string): void {
  if (semver.valid(version) !== version) throw pluginError("INVALID_PACKAGE_VERSION");
}

/** Reject both native-platform and foreign-platform traversal spellings. */
export function isSafePackageRelativePath(value: string): boolean {
  if (!value.startsWith("./") || value.includes("\0")) return false;
  const relative = value.slice(2);
  if (!relative || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)) return false;
  const posixSegments = relative.replace(/\\/g, "/").split("/");
  return !posixSegments.some((segment) => segment === "" || segment === "." || segment === "..");
}

export function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string | Uint8Array): string {
  return `sha256-${createHash("sha256").update(value).digest("base64")}`;
}

function manifestSummary(
  manifest: CliPluginManifestV1,
  entryContents: Uint8Array,
  configSchemaContents: Uint8Array,
): PluginManifestSummary {
  return {
    digest: sha256(stableJson(manifest)),
    entryDigest: sha256(entryContents),
    configSchemaDigest: sha256(configSchemaContents),
    manifestVersion: manifest.manifestVersion,
    apiVersion: manifest.apiVersion,
    kind: manifest.kind,
    displayName: manifest.display.name,
    extensionId: manifest.id,
    publisherId: manifest.publisher.id,
  };
}

function providerExport(exportsField: unknown): string | null {
  if (!isRecord(exportsField)) return null;
  const provider = exportsField[CLI_PLUGIN_EXPORT_PATH];
  if (typeof provider === "string") return provider;
  if (!isRecord(provider)) return null;
  return typeof provider.import === "string" ? provider.import : null;
}

function validateTowerAnnotations(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) validateTowerAnnotations(entry);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith("x-") && key !== "x-tower") throw pluginError("INVALID_CONFIG_SCHEMA");
    if (key === "x-tower") {
      if (!isRecord(entry) || Object.keys(entry).some((annotation) => !TOWER_ANNOTATION_KEYS.has(annotation))) {
        throw pluginError("INVALID_CONFIG_SCHEMA");
      }
      if (entry.control !== undefined
        && (typeof entry.control !== "string" || !TOWER_CONFIG_CONTROLS.has(entry.control))) {
        throw pluginError("INVALID_CONFIG_SCHEMA");
      }
      if (entry.order !== undefined && typeof entry.order !== "number") throw pluginError("INVALID_CONFIG_SCHEMA");
      if (entry.group !== undefined && typeof entry.group !== "string") throw pluginError("INVALID_CONFIG_SCHEMA");
      if (entry.advanced !== undefined && typeof entry.advanced !== "boolean") throw pluginError("INVALID_CONFIG_SCHEMA");
      if (entry.sensitive !== undefined && typeof entry.sensitive !== "boolean") throw pluginError("INVALID_CONFIG_SCHEMA");
    }
    validateTowerAnnotations(entry);
  }
}

function validateIntegrationPermissions(manifest: CliPluginManifestV1): void {
  const integrations = manifest.capabilities.integrations;
  const required = [
    ["mcp", "integration:mcp"],
    ["hooks", "integration:hooks"],
    ["skills", "integration:skills"],
  ] as const;
  if (required.some(([capability, permission]) =>
    integrations?.[capability] === true && !manifest.permissions.includes(permission))) {
    throw pluginError("INVALID_MANIFEST");
  }
}

const ROOT_SCHEMA_KEYS = new Set([
  "$schema", "$id", "title", "description", "type", "properties", "required",
  "additionalProperties", "default", "x-tower",
]);
const VALUE_SCHEMA_KEYS = new Set([
  "title", "description", "type", "items", "enum", "default", "minimum", "maximum",
  "minLength", "maxLength", "pattern", "additionalProperties", "x-tower",
]);

function validateSchemaNode(schema: unknown, root = false): void {
  if (!isRecord(schema)) throw pluginError("INVALID_CONFIG_SCHEMA");
  const allowed = root ? ROOT_SCHEMA_KEYS : VALUE_SCHEMA_KEYS;
  if (Object.keys(schema).some((key) => !allowed.has(key))) throw pluginError("INVALID_CONFIG_SCHEMA");
  if (root) {
    if (schema.$schema !== CONFIG_SCHEMA_URI || schema.type !== "object" || !isRecord(schema.properties)) {
      throw pluginError("INVALID_CONFIG_SCHEMA");
    }
    const properties = schema.properties;
    if (schema.additionalProperties !== false) throw pluginError("INVALID_CONFIG_SCHEMA");
    if (schema.required !== undefined
      && (!Array.isArray(schema.required)
        || schema.required.some((entry) => typeof entry !== "string" || !(entry in properties)))) {
      throw pluginError("INVALID_CONFIG_SCHEMA");
    }
    if (isRecord(schema["x-tower"]) && schema["x-tower"].sensitive === true) {
      throw pluginError("INVALID_CONFIG_SCHEMA");
    }
    for (const property of Object.values(properties)) validateSchemaNode(property);
    return;
  }

  const annotation = isRecord(schema["x-tower"])
    ? schema["x-tower"] as Record<string, unknown>
    : {};
  const control = annotation.control;
  if (annotation.sensitive === true
    && (schema.type !== "string" || (control !== undefined && control !== "text" && control !== "path"))) {
    throw pluginError("INVALID_CONFIG_SCHEMA");
  }
  if (schema.type === "string") {
    if (control !== undefined && !["text", "path", "select"].includes(String(control))) {
      throw pluginError("INVALID_CONFIG_SCHEMA");
    }
  } else if (schema.type === "number" || schema.type === "integer") {
    if (control !== undefined && !["number", "select"].includes(String(control))) {
      throw pluginError("INVALID_CONFIG_SCHEMA");
    }
  } else if (schema.type === "boolean") {
    if (control !== undefined && control !== "switch") throw pluginError("INVALID_CONFIG_SCHEMA");
  } else if (schema.type === "array") {
    if (!isRecord(schema.items) || schema.items.type !== "string") throw pluginError("INVALID_CONFIG_SCHEMA");
    if (control !== "multiselect" && control !== "string-list") throw pluginError("INVALID_CONFIG_SCHEMA");
    validateSchemaNode(schema.items);
  } else if (schema.type === "object") {
    if (control !== "key-value"
      || !isRecord(schema.additionalProperties)
      || schema.additionalProperties.type !== "string") {
      throw pluginError("INVALID_CONFIG_SCHEMA");
    }
    validateSchemaNode(schema.additionalProperties);
  } else {
    throw pluginError("INVALID_CONFIG_SCHEMA");
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
    throw pluginError("INVALID_CONFIG_SCHEMA");
  }
  if (schema.enum !== undefined) {
    if (schema.type === "string" && schema.enum.some((value) => typeof value !== "string")) {
      throw pluginError("INVALID_CONFIG_SCHEMA");
    }
    if ((schema.type === "number" || schema.type === "integer")
      && schema.enum.some((value) => typeof value !== "number"
        || (schema.type === "integer" && !Number.isInteger(value)))) {
      throw pluginError("INVALID_CONFIG_SCHEMA");
    }
  }
}

export function validatePluginConfigSchema(schema: unknown): asserts schema is CliConfigSchema {
  if (!isRecord(schema) || schema.$schema !== CONFIG_SCHEMA_URI || schema.type !== "object") {
    throw pluginError("INVALID_CONFIG_SCHEMA");
  }
  validateSchemaNode(schema, true);
  validateTowerAnnotations(schema);
  try {
    const ajv = new Ajv2020({ strict: false, validateSchema: true });
    ajv.addKeyword({ keyword: "x-tower", schemaType: "object", valid: true });
    ajv.compile(schema);
  } catch (error) {
    throw pluginError("INVALID_CONFIG_SCHEMA", undefined, error);
  }
}

function configValidator(schema: CliConfigSchema, useDefaults: boolean) {
  validatePluginConfigSchema(schema);
  const ajv = new Ajv2020({
    strict: false,
    allErrors: true,
    useDefaults,
    removeAdditional: false,
  });
  ajv.addKeyword({ keyword: "x-tower", schemaType: "object", valid: true });
  return ajv.compile(schema);
}

export function validatePluginSettings(
  schema: CliConfigSchema,
  settings: unknown,
  options: { applyDefaults?: boolean } = {},
): Record<string, unknown> {
  if (!isRecord(settings)) throw pluginError("INVALID_CONFIG_SCHEMA");
  const value = structuredClone(settings);
  const validate = configValidator(schema, options.applyDefaults === true);
  if (!validate(value)) throw pluginError("INVALID_CONFIG_SCHEMA");
  return value;
}

async function readJson(fileSystem: PluginFileSystem, filePath: string, errorCode: "INVALID_PACKAGE" | "INVALID_CONFIG_SCHEMA") {
  try {
    return JSON.parse((await fileSystem.readFile(filePath)).toString("utf8")) as unknown;
  } catch (error) {
    throw pluginError(errorCode, undefined, error);
  }
}

async function resolveContainedFile(
  fileSystem: PluginFileSystem,
  packageRoot: string,
  relativePath: string,
): Promise<string> {
  if (!isSafePackageRelativePath(relativePath)) throw pluginError("ENTRY_ESCAPE");
  try {
    const root = await fileSystem.realpath(packageRoot);
    const target = await fileSystem.realpath(path.resolve(root, relativePath));
    const stats = await fileSystem.stat(target);
    if (!stats.isFile() || !isPathInside(root, target)) throw pluginError("ENTRY_ESCAPE");
    return target;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENTRY_ESCAPE") throw error;
    throw pluginError("ENTRY_ESCAPE", undefined, error);
  }
}

async function scanPackageTree(
  fileSystem: PluginFileSystem,
  packageRoot: string,
): Promise<void> {
  const root = await fileSystem.realpath(packageRoot);
  const visited = new Set<string>();
  const visit = async (directory: string): Promise<void> => {
    const realDirectory = await fileSystem.realpath(directory);
    if (!isPathInside(root, realDirectory)) throw pluginError("ENTRY_ESCAPE");
    if (visited.has(realDirectory)) return;
    visited.add(realDirectory);
    for (const entry of await fileSystem.readdir(realDirectory)) {
      const entryPath = path.join(realDirectory, entry.name);
      const realEntry = entry.type === "symlink" ? await fileSystem.realpath(entryPath) : entryPath;
      if (!isPathInside(root, realEntry)) throw pluginError("ENTRY_ESCAPE");
      const stats = await fileSystem.stat(realEntry);
      if (stats.isDirectory()) await visit(realEntry);
      if (stats.isFile() && path.extname(realEntry).toLowerCase() === ".node") {
        throw pluginError("NATIVE_MODULE_REJECTED");
      }
    }
  };
  await visit(root);
}

function esmExportTarget(exportsField: unknown): string | null {
  if (typeof exportsField === "string") return exportsField;
  if (Array.isArray(exportsField)) {
    for (const candidate of exportsField) {
      const target = esmExportTarget(candidate);
      if (target) return target;
    }
    return null;
  }
  if (!isRecord(exportsField)) return null;
  if (Object.keys(exportsField).some((key) => key.startsWith("."))) {
    return esmExportTarget(exportsField["."]);
  }
  for (const [condition, candidate] of Object.entries(exportsField)) {
    if (condition === "import" || condition === "node" || condition === "default") {
      const target = esmExportTarget(candidate);
      if (target) return target;
    }
  }
  return null;
}

async function findDependencyRoot(
  fileSystem: PluginFileSystem,
  packageRoot: string,
  dependency: string,
  requireInsidePackage: boolean,
): Promise<string> {
  assertValidPackageName(dependency);
  let directory = packageRoot;
  while (true) {
    const candidate = path.join(directory, "node_modules", ...dependency.split("/"));
    try {
      await fileSystem.access(path.join(candidate, "package.json"));
      const realRoot = await fileSystem.realpath(candidate);
      const realPackageRoot = await fileSystem.realpath(packageRoot);
      if (requireInsidePackage && !isPathInside(realPackageRoot, realRoot)) {
        throw new Error("Dependency escaped package root");
      }
      return realRoot;
    } catch (error) {
      if (requireInsidePackage) throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error("Dependency package was not found");
    directory = parent;
  }
}

async function resolveEsmDependency(
  fileSystem: PluginFileSystem,
  packageRoot: string,
  dependency: string,
  requireInsidePackage: boolean,
): Promise<string> {
  const dependencyRoot = await findDependencyRoot(
    fileSystem,
    packageRoot,
    dependency,
    requireInsidePackage,
  );
  const dependencyPackage = await readJson(
    fileSystem,
    path.join(dependencyRoot, "package.json"),
    "INVALID_PACKAGE",
  );
  if (!isRecord(dependencyPackage)) throw new Error("Dependency package metadata is invalid");
  const target = dependencyPackage.exports === undefined
    ? typeof dependencyPackage.main === "string" ? dependencyPackage.main : "./index.js"
    : esmExportTarget(dependencyPackage.exports);
  if (!target) throw new Error("Dependency has no ESM root export");
  const relativeTarget = target.startsWith("./") ? target : `./${target}`;
  if (!isSafePackageRelativePath(relativeTarget)) throw new Error("Dependency export escaped package root");
  const resolved = await fileSystem.realpath(path.resolve(dependencyRoot, relativeTarget));
  const stats = await fileSystem.stat(resolved);
  if (!stats.isFile() || !isPathInside(dependencyRoot, resolved)) {
    throw new Error("Dependency export escaped package root");
  }
  if (requireInsidePackage) {
    const realPackageRoot = await fileSystem.realpath(packageRoot);
    if (!isPathInside(realPackageRoot, resolved)) throw new Error("Dependency escaped package root");
  }
  return resolved;
}

export interface ValidatePluginPackageOptions {
  fileSystem: PluginFileSystem;
  packageRoot: string;
  towerVersion: string;
  nodeVersion?: string;
  expectedName?: string;
  expectedVersion?: string;
  expectedId?: string;
  requireDependenciesInsidePackage?: boolean;
  resolveDependency?: (dependency: string, entryPath: string) => Promise<string | void>;
}

export async function validatePluginPackage(options: ValidatePluginPackageOptions): Promise<ValidatedPluginPackage> {
  const packageRoot = await options.fileSystem.realpath(options.packageRoot).catch((error) => {
    throw pluginError("INVALID_PACKAGE", options.expectedName, error);
  });
  const packageJson = await readJson(options.fileSystem, path.join(packageRoot, "package.json"), "INVALID_PACKAGE");
  if (!isRecord(packageJson)
    || typeof packageJson.name !== "string"
    || typeof packageJson.version !== "string") {
    throw pluginError("INVALID_PACKAGE", options.expectedName);
  }
  assertValidPackageName(packageJson.name);
  assertExactSemVer(packageJson.version);
  if ((options.expectedName && packageJson.name !== options.expectedName)
    || (options.expectedVersion && packageJson.version !== options.expectedVersion)) {
    throw pluginError("INVALID_PACKAGE", options.expectedName);
  }
  if (packageJson.type !== "module") throw pluginError("INVALID_PACKAGE", packageJson.name);
  if (!isCliPluginManifestV1(packageJson.tower)) {
    if (isLegacyCliPluginManifestV1(packageJson.tower)) {
      throw pluginError("MANIFEST_MIGRATION_REQUIRED", packageJson.name);
    }
    throw pluginError("INVALID_MANIFEST", packageJson.name);
  }
  const manifest = packageJson.tower;
  if (options.expectedId && manifest.id !== options.expectedId) {
    throw pluginError("INVALID_MANIFEST", options.expectedId);
  }
  validateIntegrationPermissions(manifest);
  if (new Set(manifest.permissions).size !== manifest.permissions.length
    || !semver.validRange(manifest.cliDependency.supportedVersions)) {
    throw pluginError("INVALID_MANIFEST", manifest.id);
  }
  if (!isCliPluginApiVersionCompatible(manifest.apiVersion)) {
    throw pluginError("INCOMPATIBLE_PLUGIN", packageJson.name);
  }
  if (!semver.validRange(manifest.compatibility.tower)
    || !semver.satisfies(options.towerVersion, manifest.compatibility.tower)
    || !semver.validRange(manifest.compatibility.node)
    || !semver.satisfies(options.nodeVersion ?? process.versions.node, manifest.compatibility.node)) {
    throw pluginError("INCOMPATIBLE_PLUGIN", packageJson.name);
  }

  const exportPath = providerExport(packageJson.exports);
  if (!exportPath || exportPath !== manifest.entry || !/\.(?:m?js)$/.test(exportPath)) {
    throw pluginError("INVALID_PACKAGE", packageJson.name);
  }
  const entryPath = await resolveContainedFile(options.fileSystem, packageRoot, manifest.entry);
  const configSchemaPath = await resolveContainedFile(options.fileSystem, packageRoot, manifest.configSchema);
  const configSchemaContents = await options.fileSystem.readFile(configSchemaPath);
  validatePluginConfigSchema(await readJson(options.fileSystem, configSchemaPath, "INVALID_CONFIG_SCHEMA"));
  await scanPackageTree(options.fileSystem, packageRoot);

  const dependencies = isRecord(packageJson.dependencies) ? Object.keys(packageJson.dependencies) : [];
  for (const dependency of dependencies) {
    try {
      const resolved = options.resolveDependency
        ? await options.resolveDependency(dependency, entryPath)
        : await resolveEsmDependency(
            options.fileSystem,
            packageRoot,
            dependency,
            options.requireDependenciesInsidePackage ?? false,
          );
      if (options.requireDependenciesInsidePackage && typeof resolved === "string") {
        const realDependency = await options.fileSystem.realpath(resolved);
        if (!isPathInside(packageRoot, realDependency)) throw new Error("Dependency escaped package root");
      }
    } catch (error) {
      throw pluginError("DEPENDENCY_UNAVAILABLE", packageJson.name, error);
    }
  }

  return {
    packageRoot,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    extensionId: manifest.id,
    entryPath,
    configSchemaPath,
    manifest,
    manifestSummary: manifestSummary(
      manifest,
      await options.fileSystem.readFile(entryPath),
      configSchemaContents,
    ),
  };
}

export function permissionDiff(
  requested: CliPluginPermission[],
  previous: CliPluginPermission[] = [],
): PluginPermissionDiff {
  const current = [...new Set(requested)].sort();
  const before = new Set(previous);
  const after = new Set(current);
  return {
    requested: current,
    added: current.filter((permission) => !before.has(permission)),
    removed: [...new Set(previous)].filter((permission) => !after.has(permission)).sort(),
  };
}

export function createInstallPlan(input: {
  source: PluginSource;
  sourcePath?: string;
  packageName?: string;
  pluginId?: string;
  catalog?: PluginInstallPlan["catalog"];
  dependency?: PluginInstallPlan["dependency"];
  plugin: ValidatedPluginPackage;
  integrity: string;
  previous?: PluginRegistration;
}): PluginInstallPlan {
  const planBase = {
    version: PLUGIN_INSTALL_PLAN_VERSION,
    operation: input.source === "local" || input.source === "development"
      ? "register-local" as const
      : input.previous
        ? "upgrade" as const
        : "install" as const,
    pluginId: input.pluginId ?? input.plugin.extensionId,
    source: input.source,
    ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
    ...(input.packageName ? { packageName: input.packageName } : {}),
    ...(input.catalog ? { catalog: structuredClone(input.catalog) } : {}),
    fromVersion: input.previous?.version ?? null,
    fromActivationPlanDigest: input.previous?.activationPlanDigest ?? null,
    toVersion: input.plugin.packageVersion,
    integrity: input.integrity,
    manifest: input.plugin.manifestSummary,
    manifestData: structuredClone(input.plugin.manifest),
    permissions: permissionDiff(input.plugin.manifest.permissions, input.previous?.permissions),
    ...(input.dependency ? { dependency: structuredClone(input.dependency) } : {}),
  };
  return { ...planBase, planDigest: sha256(stableJson(planBase)) };
}

export function isMatchingPlan(expected: PluginInstallPlan, received: PluginInstallPlan): boolean {
  const receivedBase = {
    version: received.version,
    operation: received.operation,
    pluginId: received.pluginId,
    source: received.source,
    ...(received.sourcePath ? { sourcePath: received.sourcePath } : {}),
    ...(received.packageName ? { packageName: received.packageName } : {}),
    ...(received.catalog ? { catalog: received.catalog } : {}),
    fromVersion: received.fromVersion,
    fromActivationPlanDigest: received.fromActivationPlanDigest,
    toVersion: received.toVersion,
    integrity: received.integrity,
    manifest: received.manifest,
    manifestData: received.manifestData,
    permissions: received.permissions,
    ...(received.dependency ? { dependency: received.dependency } : {}),
  };
  return expected.planDigest === received.planDigest
    && sha256(stableJson(receivedBase)) === received.planDigest;
}
