import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import * as tar from "tar";
import { isWindows, type PlatformName } from "@tower/ai-sdk";
import { findCommandPath } from "./paths.js";
import { prepareSpawnTarget } from "./process-executor.js";
import { assertExactSemVer, assertValidPackageName } from "./plugin-validation.js";
import { pluginError } from "./plugin-errors.js";
import type { PluginFileSystem } from "./plugin-filesystem.js";
import { NodePluginFileSystem } from "./plugin-filesystem.js";

export interface NpmPackageResolution {
  packageName: string;
  version: string;
  integrity: string;
  tarballUrl: string;
  registry: string;
}

export interface NpmPackageProvider {
  resolve(packageName: string, version: string): Promise<NpmPackageResolution>;
  stage(resolution: NpmPackageResolution, destination: string): Promise<void>;
}

export interface PackageCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type PackageCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => Promise<PackageCommandResult>;

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const MAX_TARBALL_BYTES = 100 * 1024 * 1024;

function registryPackageUrl(registry: string, packageName: string): string {
  return `${registry.replace(/\/$/, "")}/${encodeURIComponent(packageName)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultCommandRunner(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<PackageCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolve({
        exitCode: typeof error?.code === "number" ? error.code : 0,
        stdout,
        stderr,
      });
    });
  });
}

export function verifyPackageIntegrity(contents: Uint8Array, integrity: string): boolean {
  for (const token of integrity.trim().split(/\s+/)) {
    const match = /^(sha(?:256|384|512))-([A-Za-z0-9+/]+={0,2})$/.exec(token);
    if (!match) continue;
    const actual = createHash(match[1]).update(contents).digest("base64");
    if (actual === match[2]) return true;
  }
  return false;
}

export function isValidPackageIntegrity(integrity: string): boolean {
  return integrity.trim().split(/\s+/).some((token) =>
    /^(?:sha256|sha384|sha512)-[A-Za-z0-9+/]+={0,2}$/.test(token));
}

/** Validate an npm tar entry before `strip: 1` extraction. */
export function assertSafeArchivePath(entryPath: string): void {
  if (!entryPath || entryPath.includes("\0")
    || path.posix.isAbsolute(entryPath)
    || path.win32.isAbsolute(entryPath)) {
    throw pluginError("UNSAFE_ARCHIVE");
  }
  const normalized = entryPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (segments[0] !== "package"
    || segments.slice(1).some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw pluginError("UNSAFE_ARCHIVE");
  }
}

function assertSafeArchiveLink(entryPath: string, linkPath: string): void {
  if (!linkPath) return;
  const normalizedEntry = entryPath.replace(/\\/g, "/");
  const normalizedLink = linkPath.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalizedLink) || path.win32.isAbsolute(linkPath)) {
    throw pluginError("UNSAFE_ARCHIVE");
  }
  const resolved = normalizedLink.startsWith("package/")
    ? path.posix.normalize(normalizedLink)
    : path.posix.normalize(path.posix.join(path.posix.dirname(normalizedEntry), normalizedLink));
  assertSafeArchivePath(resolved);
}

async function inspectArchive(tarballPath: string): Promise<void> {
  try {
    await tar.t({
      file: tarballPath,
      filter(entryPath, entry) {
        assertSafeArchivePath(entryPath);
        if ("linkpath" in entry && entry.linkpath) assertSafeArchiveLink(entryPath, entry.linkpath);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "UNSAFE_ARCHIVE") throw error;
    throw pluginError("UNSAFE_ARCHIVE", undefined, error);
  }
}

export interface DefaultNpmPackageProviderOptions {
  registry?: string;
  fetch?: typeof fetch;
  fileSystem?: PluginFileSystem;
  commandRunner?: PackageCommandRunner;
  npmExecutable?: string;
  env?: NodeJS.ProcessEnv;
  platform?: PlatformName;
  maxTarballBytes?: number;
}

export class DefaultNpmPackageProvider implements NpmPackageProvider {
  private readonly registry: string;
  private readonly fetchImpl: typeof fetch;
  private readonly fileSystem: PluginFileSystem;
  private readonly commandRunner: PackageCommandRunner;
  private readonly npmExecutable: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: PlatformName;
  private readonly maxTarballBytes: number;

  constructor(options: DefaultNpmPackageProviderOptions = {}) {
    this.registry = options.registry ?? DEFAULT_REGISTRY;
    this.fetchImpl = options.fetch ?? fetch;
    this.fileSystem = options.fileSystem ?? new NodePluginFileSystem();
    this.commandRunner = options.commandRunner ?? defaultCommandRunner;
    this.platform = options.platform ?? process.platform as PlatformName;
    this.npmExecutable = options.npmExecutable
      ?? (isWindows(this.platform) ? "npm.cmd" : "npm");
    this.env = options.env ?? process.env;
    this.maxTarballBytes = options.maxTarballBytes ?? MAX_TARBALL_BYTES;
  }

  async resolve(packageName: string, version: string): Promise<NpmPackageResolution> {
    assertValidPackageName(packageName);
    assertExactSemVer(version);
    try {
      const response = await this.fetchImpl(registryPackageUrl(this.registry, packageName), {
        headers: { accept: "application/vnd.npm.install-v1+json" },
      });
      if (!response.ok) throw new Error(`Registry status ${response.status}`);
      const metadata = await response.json() as unknown;
      if (!isRecord(metadata) || !isRecord(metadata.versions) || !isRecord(metadata.versions[version])) {
        throw new Error("Exact package version missing");
      }
      const dist = metadata.versions[version].dist;
      if (!isRecord(dist) || typeof dist.integrity !== "string" || typeof dist.tarball !== "string") {
        throw new Error("Package integrity metadata missing");
      }
      const tarballUrl = new URL(dist.tarball);
      if (!isValidPackageIntegrity(dist.integrity)
        || (tarballUrl.protocol !== "https:" && tarballUrl.protocol !== "http:")) {
        throw new Error("Package distribution metadata is invalid");
      }
      return {
        packageName,
        version,
        integrity: dist.integrity,
        tarballUrl: tarballUrl.href,
        registry: this.registry,
      };
    } catch (error) {
      throw pluginError("PACKAGE_NOT_FOUND", packageName, error);
    }
  }

  async stage(resolution: NpmPackageResolution, destination: string): Promise<void> {
    const parent = path.dirname(destination);
    await this.fileSystem.mkdir(parent);
    const temporary = await this.fileSystem.mkdtemp(path.join(parent, ".npm-package-"));
    const tarballPath = path.join(temporary, "package.tgz");
    try {
      const response = await this.fetchImpl(resolution.tarballUrl);
      if (!response.ok) throw new Error(`Tarball status ${response.status}`);
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > this.maxTarballBytes) throw new Error("Tarball too large");
      const contents = new Uint8Array(await response.arrayBuffer());
      if (contents.byteLength > this.maxTarballBytes) throw new Error("Tarball too large");
      if (!verifyPackageIntegrity(contents, resolution.integrity)) {
        throw pluginError("INTEGRITY_MISMATCH", resolution.packageName);
      }
      await this.fileSystem.writeFile(tarballPath, contents);
      await inspectArchive(tarballPath);
      await this.fileSystem.mkdir(destination);
      await tar.x({
        file: tarballPath,
        cwd: destination,
        strip: 1,
        preservePaths: false,
        filter(entryPath, entry) {
          assertSafeArchivePath(entryPath);
          if ("linkpath" in entry && entry.linkpath) assertSafeArchiveLink(entryPath, entry.linkpath);
          return true;
        },
      });

      const installArgs = [
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--package-lock=false",
        "--no-audit",
        "--no-fund",
        `--registry=${resolution.registry}`,
      ];
      let command = this.npmExecutable;
      let commandArgs = installArgs;
      if (isWindows(this.platform) && /\.cmd$/i.test(command)) {
        const resolved = await findCommandPath(command, { env: this.env, platform: this.platform });
        if (!resolved) throw new Error("npm executable not found");
        const target = await prepareSpawnTarget(resolved, installArgs, this.platform, this.env);
        command = target.command;
        commandArgs = target.args;
      }
      const result = await this.commandRunner(command, commandArgs, {
        cwd: destination,
        env: {
          ...this.env,
          npm_config_ignore_scripts: "true",
          npm_config_package_lock: "false",
        },
      });
      if (result.exitCode !== 0) throw new Error("Production dependency installation failed");
    } catch (error) {
      await this.fileSystem.rm(destination).catch(() => undefined);
      if (error instanceof Error && "code" in error
        && ["INTEGRITY_MISMATCH", "UNSAFE_ARCHIVE"].includes(String(error.code))) throw error;
      throw pluginError("INSTALL_FAILED", resolution.packageName, error);
    } finally {
      await this.fileSystem.rm(temporary).catch(() => undefined);
    }
  }
}
