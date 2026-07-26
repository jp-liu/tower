import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliPluginManifestV1 } from "@tower/ai-sdk";
import {
  CliPluginRuntime,
  CommandResolver,
  FixtureExtensionCatalog,
  NodePluginFileSystem,
  PluginRegistry,
  PrebuiltArtifactProvider,
  SafeCliDependencyVerifier,
  assertSafeArtifactPath,
  parseExtensionCatalog,
  type CatalogArtifact,
  type CliDependencyDiagnostic,
  type CliDependencyVerifier,
  type ExtensionCatalogIndexV1,
  type PrebuiltArtifactProviderOptions,
} from "../src/index.js";

const fixtureRoot = fileURLToPath(new URL("./fixtures/valid-plugin", import.meta.url));
const temporaryRoots: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tower-extension-test-"));
  temporaryRoots.push(directory);
  return directory;
}

async function createArtifact(options: { symlink?: boolean; dependency?: boolean } = {}) {
  const root = await temporaryDirectory();
  const archiveRoot = path.join(root, "archive");
  const packageRoot = path.join(archiveRoot, "package");
  await fs.cp(fixtureRoot, packageRoot, { recursive: true });
  if (options.symlink) {
    await fs.symlink("provider.js", path.join(packageRoot, "linked-provider.js"));
  }
  if (options.dependency) {
    const packageJsonPath = path.join(packageRoot, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
    packageJson.dependencies = { "fixture-dependency": "1.0.0" };
    await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const dependencyRoot = path.join(packageRoot, "node_modules", "fixture-dependency");
    await fs.mkdir(dependencyRoot, { recursive: true });
    await fs.writeFile(path.join(dependencyRoot, "package.json"), JSON.stringify({
      name: "fixture-dependency",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }));
    await fs.writeFile(path.join(dependencyRoot, "index.js"), "export const dependencyValue = true;\n");
    const providerPath = path.join(packageRoot, "provider.js");
    await fs.writeFile(providerPath, `import "fixture-dependency";\n${await fs.readFile(providerPath, "utf8")}`);
  }
  const tarballPath = path.join(root, "extension.tgz");
  await tar.c({ gzip: true, cwd: archiveRoot, file: tarballPath }, ["package"]);
  const contents = await fs.readFile(tarballPath);
  return {
    contents,
    artifact: {
      url: "https://catalog.example.test/fixture.tgz",
      sha256: createHash("sha256").update(contents).digest("hex"),
      size: contents.byteLength,
    } satisfies CatalogArtifact,
  };
}

async function createSizedArtifact(fileSizes: number[]) {
  const root = await temporaryDirectory();
  const archiveRoot = path.join(root, "archive");
  const packageRoot = path.join(archiveRoot, "package");
  await fs.mkdir(packageRoot, { recursive: true });
  await Promise.all(fileSizes.map((size, index) =>
    fs.writeFile(path.join(packageRoot, `file-${index}.js`), Buffer.alloc(size))));
  const tarballPath = path.join(root, "extension.tgz");
  await tar.c({ gzip: true, cwd: archiveRoot, file: tarballPath }, ["package"]);
  const contents = await fs.readFile(tarballPath);
  return {
    contents,
    artifact: {
      url: "https://catalog.example.test/quota-fixture.tgz",
      sha256: createHash("sha256").update(contents).digest("hex"),
      size: contents.byteLength,
    } satisfies CatalogArtifact,
  };
}

function catalogDocument(artifact: CatalogArtifact): ExtensionCatalogIndexV1 {
  return {
    schemaVersion: 1,
    extensions: [{
      id: "fixture.tower-cli",
      kind: "cli-provider",
      publisher: { id: "fixture-labs", name: "Fixture Labs" },
      display: { name: "Fixture CLI" },
      versions: [{
        version: "1.0.0",
        artifact,
        cliDependency: {
          name: "Untrusted index-only label",
          supportedVersions: "*",
          installDocs: "https://catalog.example.test/display-only",
        },
      }],
    }],
  };
}

function artifactProvider(
  contents: Uint8Array,
  headers: Record<string, string> = {},
  options: Omit<PrebuiltArtifactProviderOptions, "fetchImpl"> = {},
) {
  return new PrebuiltArtifactProvider({
    ...options,
    fetchImpl: async () => new Response(
      contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength) as ArrayBuffer,
      {
        status: 200,
        headers: { "content-length": String(contents.byteLength), ...headers },
      },
    ),
  });
}

function readyDependencyVerifier() {
  const diagnostic: CliDependencyDiagnostic = {
    dependency: "Fixture CLI",
    state: "ready",
    commandPath: "/tmp/fixture-cli",
    detectedVersion: "1.2.3",
    supportedVersions: ">=1.0.0 <2.0.0",
    homepage: "https://example.com/fixture-cli",
    installDocs: "https://example.com/fixture-cli/install",
    managedByTower: false,
  };
  return {
    diagnostic,
    verifier: { verify: vi.fn(async () => diagnostic) } satisfies CliDependencyVerifier,
  };
}

async function fixtureManifest(): Promise<CliPluginManifestV1> {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(fixtureRoot, "package.json"), "utf8"),
  ) as { tower: CliPluginManifestV1 };
  return structuredClone(packageJson.tower);
}

class FailingRegistryFileSystem extends NodePluginFileSystem {
  failNextRegistryWrite = false;

  override async atomicWrite(filePath: string, data: string): Promise<void> {
    if (this.failNextRegistryWrite && filePath.endsWith("registry.v2.json")) {
      this.failNextRegistryWrite = false;
      throw new Error("injected registry failure");
    }
    await super.atomicWrite(filePath, data);
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe("extension catalog contract", () => {
  it("accepts the static v1 shape and rejects untrusted transport and metadata", async () => {
    const { artifact } = await createArtifact();
    const valid = catalogDocument(artifact);
    expect(parseExtensionCatalog(valid)).toEqual(valid);

    const invalidCases = [
      { ...valid, schemaVersion: 2 },
      { ...valid, unexpected: true },
      {
        ...valid,
        extensions: [{ ...valid.extensions[0]!, kind: "command-template" }],
      },
      {
        ...valid,
        extensions: [{
          ...valid.extensions[0]!,
          versions: [{ ...valid.extensions[0]!.versions[0]!, artifact: { ...artifact, url: "http://unsafe.test/x" } }],
        }],
      },
      {
        ...valid,
        extensions: [{
          ...valid.extensions[0]!,
          versions: [{ ...valid.extensions[0]!.versions[0]!, artifact: { ...artifact, sha256: "bad" } }],
        }],
      },
      { ...valid, extensions: [valid.extensions[0]!, valid.extensions[0]!] },
    ];
    for (const value of invalidCases) {
      expect(() => parseExtensionCatalog(value)).toThrowError(expect.objectContaining({ code: "CATALOG_INVALID" }));
    }
  });

  it("keeps catalog CLI dependency metadata display-only", async () => {
    const { contents, artifact } = await createArtifact();
    const { verifier, diagnostic } = readyDependencyVerifier();
    const dataRoot = await temporaryDirectory();
    const runtime = new CliPluginRuntime({
      dataRoot,
      towerVersion: "0.3.0",
      artifactProvider: artifactProvider(contents),
      cliDependencyVerifier: verifier,
    });
    const plan = await runtime.planCatalogInstall(
      new FixtureExtensionCatalog(catalogDocument(artifact)),
      "fixture.tower-cli",
      "1.0.0",
    );

    expect(verifier.verify).toHaveBeenCalledWith(expect.objectContaining({
      cliDependency: expect.objectContaining({ name: "Fixture CLI" }),
    }));
    expect(plan.dependency).toEqual(diagnostic);
    expect(plan.manifestData.cliDependency.name).toBe("Fixture CLI");
    expect(plan.manifestData.cliDependency.name).not.toBe("Untrusted index-only label");
  });

  it("rejects catalog identity and publisher claims that do not match the artifact manifest", async () => {
    const { contents, artifact } = await createArtifact();
    const { verifier } = readyDependencyVerifier();
    const runtime = new CliPluginRuntime({
      dataRoot: await temporaryDirectory(),
      towerVersion: "0.3.0",
      artifactProvider: artifactProvider(contents),
      cliDependencyVerifier: verifier,
    });
    const wrongPublisher = catalogDocument(artifact);
    wrongPublisher.extensions[0]!.publisher = { id: "other-publisher", name: "Other Publisher" };
    await expect(runtime.planCatalogInstall(
      new FixtureExtensionCatalog(wrongPublisher),
      "fixture.tower-cli",
      "1.0.0",
    )).rejects.toMatchObject({ code: "INVALID_MANIFEST" });

    const wrongId = catalogDocument(artifact);
    wrongId.extensions[0]!.id = "other.extension";
    await expect(runtime.planCatalogInstall(
      new FixtureExtensionCatalog(wrongId),
      "other.extension",
      "1.0.0",
    )).rejects.toMatchObject({ code: "INVALID_MANIFEST" });
  });
});

describe("prebuilt artifact safety", () => {
  it("verifies exact size and SHA-256 before extraction", async () => {
    const root = await temporaryDirectory();
    const { contents, artifact } = await createArtifact();
    const provider = artifactProvider(contents);
    await expect(provider.stage(
      { ...artifact, size: artifact.size + 1 },
      path.join(root, "size"),
    )).rejects.toMatchObject({ code: "ARTIFACT_SIZE_MISMATCH" });
    await expect(provider.stage(
      { ...artifact, sha256: "0".repeat(64) },
      path.join(root, "hash"),
    )).rejects.toMatchObject({ code: "INTEGRITY_MISMATCH" });
  });

  it("rejects traversal spellings and symbolic links", async () => {
    for (const unsafe of ["../escape", "package/../escape", "package\\..\\escape", "/absolute"] ) {
      expect(() => assertSafeArtifactPath(unsafe)).toThrowError(expect.objectContaining({ code: "UNSAFE_ARCHIVE" }));
    }
    const root = await temporaryDirectory();
    const { contents, artifact } = await createArtifact({ symlink: true });
    await expect(artifactProvider(contents).stage(
      artifact,
      path.join(root, "package"),
    )).rejects.toMatchObject({ code: "UNSAFE_ARCHIVE" });
  });

  it.each([
    {
      name: "a file whose declared size exceeds the per-file limit",
      fileSizes: [1_024],
      limits: { maxArchiveFileBytes: 512 },
    },
    {
      name: "declared file sizes whose total exceeds the expanded-byte limit",
      fileSizes: [400, 400],
      limits: { maxArchiveExpandedBytes: 700 },
    },
    {
      name: "more entries than the archive entry limit",
      fileSizes: [1, 1],
      limits: { maxArchiveEntries: 2 },
    },
  ])("rejects $name and cleans extraction state", async ({ fileSizes, limits }) => {
    const root = await temporaryDirectory();
    const destination = path.join(root, "package");
    const { contents, artifact } = await createSizedArtifact(fileSizes);

    await expect(artifactProvider(contents, {}, limits).stage(
      artifact,
      destination,
    )).rejects.toMatchObject({ code: "UNSAFE_ARCHIVE" });
    await expect(fs.access(destination)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(path.join(root, "artifact.tgz"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("catalog installation lifecycle", () => {
  it("installs atomically to the immutable directory and is idempotent", async () => {
    const { contents, artifact } = await createArtifact({ dependency: true });
    const dataRoot = await temporaryDirectory();
    const { verifier } = readyDependencyVerifier();
    const runtime = new CliPluginRuntime({
      dataRoot,
      towerVersion: "0.3.0",
      artifactProvider: artifactProvider(contents),
      cliDependencyVerifier: verifier,
    });
    const catalog = new FixtureExtensionCatalog(catalogDocument(artifact));
    const plan = await runtime.planCatalogInstall(catalog, "fixture.tower-cli", "1.0.0");
    expect(await fs.readdir(runtime.registry.stagingDir)).toEqual([]);

    const installed = await runtime.installCatalog(plan);
    expect(installed.manifest.packageTreeDigest).toMatch(/^sha256-/);
    expect(installed).toMatchObject({
      id: "fixture.tower-cli",
      source: "catalog",
      enabled: false,
      installPath: path.join(
        dataRoot,
        "extensions",
        "cli-provider",
        "fixture.tower-cli",
        `1.0.0-${artifact.sha256}`,
      ),
    });
    await expect(fs.access(path.join(installed.installPath, "script-ran"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await runtime.installCatalog(plan)).toEqual(installed);
    expect(await fs.readdir(path.dirname(installed.installPath))).toEqual([path.basename(installed.installPath)]);

    await fs.writeFile(
      path.join(installed.installPath, "node_modules", "fixture-dependency", "index.js"),
      "export const dependencyValue = false;\n",
    );
    await expect(runtime.installCatalog(plan)).rejects.toMatchObject({ code: "PLUGIN_CORRUPT" });
  });

  it("rolls back a staged install when the registry commit fails", async () => {
    const { contents, artifact } = await createArtifact();
    const dataRoot = await temporaryDirectory();
    const fileSystem = new FailingRegistryFileSystem();
    const { verifier } = readyDependencyVerifier();
    const runtime = new CliPluginRuntime({
      dataRoot,
      towerVersion: "0.3.0",
      fileSystem,
      artifactProvider: artifactProvider(contents),
      cliDependencyVerifier: verifier,
    });
    const plan = await runtime.planCatalogInstall(
      new FixtureExtensionCatalog(catalogDocument(artifact)),
      "fixture.tower-cli",
      "1.0.0",
    );
    fileSystem.failNextRegistryWrite = true;
    await expect(runtime.installCatalog(plan)).rejects.toThrowError("injected registry failure");
    expect(await runtime.get("fixture.tower-cli")).toBeNull();
    await expect(fs.access(path.join(
      dataRoot,
      "extensions",
      "cli-provider",
      "fixture.tower-cli",
      `1.0.0-${artifact.sha256}`,
    ))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readdir(runtime.registry.stagingDir)).toEqual([]);
  });

  it("marks local SDK registration as development", async () => {
    const source = await temporaryDirectory();
    await fs.cp(fixtureRoot, source, { recursive: true });
    const runtime = new CliPluginRuntime({ dataRoot: await temporaryDirectory(), towerVersion: "0.3.0" });
    const plan = await runtime.planLocalRegistration(source);
    const registration = await runtime.registerLocal(plan);
    expect(registration).toMatchObject({
      id: "fixture.tower-cli",
      source: "development",
      installPath: await fs.realpath(source),
    });
  });

  it("returns an explicit migration error for the pre-Catalog Manifest v1 shape", async () => {
    const source = await temporaryDirectory();
    await fs.cp(fixtureRoot, source, { recursive: true });
    const packagePath = path.join(source, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8")) as {
      tower: Record<string, unknown>;
    };
    delete packageJson.tower.id;
    delete packageJson.tower.publisher;
    delete packageJson.tower.entry;
    delete packageJson.tower.cliDependency;
    await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    const runtime = new CliPluginRuntime({ dataRoot: await temporaryDirectory(), towerVersion: "0.3.0" });
    await expect(runtime.planLocalRegistration(source)).rejects.toMatchObject({
      code: "MANIFEST_MIGRATION_REQUIRED",
    });
  });
});

describe("CLI dependency preflight", () => {
  it("uses argument arrays and enforces the supported version range", async () => {
    const manifest = await fixtureManifest();
    manifest.command.versionArgs = ["--version", "; touch /tmp/never"];
    const execute = vi.fn(async (spec) => ({
      exitCode: 0,
      signal: null,
      stdout: "fixture-cli 1.4.0\n",
      stderr: "",
      durationMs: 1,
      spec,
    }));
    const resolver = new CommandResolver({
      platform: "linux",
      env: { PATH: "/safe/bin" },
      fileSystem: {
        exists: async (candidate) => candidate === "/safe/bin/fixture-cli",
        executable: async (candidate) => candidate === "/safe/bin/fixture-cli",
      },
      executor: { execute },
    });
    const verifier = new SafeCliDependencyVerifier({
      platform: "linux",
      env: { PATH: "/safe/bin", SECRET_CANARY: "must-not-propagate" },
      cwd: "/work",
      resolver,
    });
    await expect(verifier.verify(manifest)).resolves.toMatchObject({
      state: "ready",
      commandPath: "/safe/bin/fixture-cli",
      detectedVersion: "1.4.0",
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--version", "; touch /tmp/never"] }),
      expect.objectContaining({ timeoutMs: 3_000 }),
    );

    manifest.cliDependency.supportedVersions = ">=2.0.0";
    await expect(verifier.verify(manifest)).rejects.toMatchObject({
      code: "CLI_DEPENDENCY_UNAVAILABLE",
      diagnostic: expect.objectContaining({ state: "version-incompatible", detectedVersion: "1.4.0" }),
    });
  });

  it("returns a structured missing-command diagnostic", async () => {
    const manifest = await fixtureManifest();
    const resolver = new CommandResolver({
      platform: "linux",
      env: { PATH: "/empty" },
      fileSystem: { exists: async () => false, executable: async () => false },
      executor: { execute: vi.fn() },
    });
    const verifier = new SafeCliDependencyVerifier({ platform: "linux", env: { PATH: "/empty" }, resolver });
    await expect(verifier.verify(manifest)).rejects.toMatchObject({
      code: "CLI_DEPENDENCY_UNAVAILABLE",
      diagnostic: expect.objectContaining({
        dependency: "Fixture CLI",
        state: "missing",
        commandPath: null,
        managedByTower: false,
      }),
    });
  });

  it.skipIf(os.platform() === "win32")("does not interpret version arguments as shell input", async () => {
    const root = await temporaryDirectory();
    const executable = path.join(root, "fixture-cli");
    const marker = path.join(root, "shell-ran");
    await fs.writeFile(executable, "#!/bin/sh\nprintf 'fixture-cli 1.3.0\\n'\n");
    await fs.chmod(executable, 0o755);
    const manifest = await fixtureManifest();
    manifest.command.default = executable;
    manifest.command.aliases = [];
    manifest.command.knownPaths = {};
    manifest.command.versionArgs = ["--version", `;touch ${marker}`];
    const verifier = new SafeCliDependencyVerifier({
      platform: process.platform as "darwin" | "linux",
      env: { PATH: "/usr/bin:/bin", HOME: root },
      cwd: root,
    });
    await expect(verifier.verify(manifest)).resolves.toMatchObject({ state: "ready" });
    await expect(fs.access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("legacy registry migration", () => {
  it("copies v1 registrations without touching the legacy registry or install directory", async () => {
    const dataRoot = await temporaryDirectory();
    const oldInstall = path.join(dataRoot, "ai", "plugins", "packages", "old-install");
    await fs.mkdir(oldInstall, { recursive: true });
    const registry = new PluginRegistry({ dataRoot });
    const timestamp = "2026-01-01T00:00:00.000Z";
    const legacy = `${JSON.stringify({
      version: 1,
      plugins: {
        "@legacy/provider": {
          id: "@legacy/provider",
          version: "1.0.0",
          integrity: "sha512-legacy",
          source: "npm",
          installPath: oldInstall,
          manifest: {
            digest: "manifest",
            entryDigest: "entry",
            configSchemaDigest: "schema",
            manifestVersion: 1,
            apiVersion: "1.0",
            kind: "cli-provider",
            displayName: "Legacy Provider",
          },
          permissions: ["process:spawn"],
          activationPlanDigest: "plan",
          permissionConfirmation: null,
          enabled: false,
          installedAt: timestamp,
          updatedAt: timestamp,
        },
      },
    }, null, 2)}\n`;
    await fs.mkdir(path.dirname(registry.legacyRegistryPath), { recursive: true });
    await fs.writeFile(registry.legacyRegistryPath, legacy);

    expect(await registry.list()).toEqual([expect.objectContaining({
      id: "@legacy/provider",
      source: "legacy",
      sourceLocator: "@legacy/provider",
      installPath: oldInstall,
    })]);
    expect(await fs.readFile(registry.legacyRegistryPath, "utf8")).toBe(legacy);
    expect(JSON.parse(await fs.readFile(registry.registryPath, "utf8"))).toMatchObject({ version: 2 });

    const runtime = new CliPluginRuntime({ dataRoot, towerVersion: "0.3.0" });
    await runtime.uninstall("@legacy/provider");
    await expect(fs.access(oldInstall)).resolves.toBeUndefined();
    expect(await fs.readFile(registry.legacyRegistryPath, "utf8")).toBe(legacy);
  });
});
