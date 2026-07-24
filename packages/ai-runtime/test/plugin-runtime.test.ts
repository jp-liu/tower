import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliHostContext, CliPluginManifestV1, CliPluginPermission } from "@tower/ai-sdk";
import {
  CliPluginRuntime,
  DefaultNpmPackageProvider,
  NodePluginFileSystem,
  PluginRegistry,
  assertSafeArchivePath,
  isSafePackageRelativePath,
  type NpmPackageProvider,
  type NpmPackageResolution,
  type PackageCommandRunner,
} from "../src/index.js";

declare global {
  var __towerFixtureLoads: number | undefined;
  var __invalidFixtureExecuted: boolean | undefined;
  var __towerInvalidExportLoads: number | undefined;
  var __towerInvalidAdapterLoads: number | undefined;
}

const fixtureRoot = fileURLToPath(new URL("./fixtures/valid-plugin", import.meta.url));
const temporaryRoots: string[] = [];

function fixtureIntegrity(version: string): string {
  return `sha512-${createHash("sha512").update(version).digest("base64")}`;
}

async function temporaryDirectory(prefix = "tower-plugin-test-"): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(directory);
  return directory;
}

async function readPackageJson(packageRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8")) as Record<string, unknown>;
}

async function writePackageJson(packageRoot: string, packageJson: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function syncProviderManifest(packageRoot: string): Promise<void> {
  const packageJson = await readPackageJson(packageRoot);
  const manifest = packageJson.tower;
  await fs.writeFile(path.join(packageRoot, "provider.js"), `
globalThis.__towerFixtureLoads = (globalThis.__towerFixtureLoads ?? 0) + 1;
export const towerCliPlugin = {
  manifest: ${JSON.stringify(manifest)},
  createAdapter() {
    return {
      buildSessionProcess(options) { return { command: "fixture-cli", args: [options.prompt] }; },
      async generate() { return { text: "fixture-ok" }; },
      async models() { return [{ id: "fixture" }]; }
    };
  }
};
`);
}

async function createFixture(options: {
  name?: string;
  version?: string;
  permissions?: CliPluginPermission[];
  dependencies?: Record<string, string>;
} = {}): Promise<string> {
  const parent = await temporaryDirectory();
  const packageRoot = path.join(parent, "plugin");
  await fs.cp(fixtureRoot, packageRoot, { recursive: true });
  const packageJson = await readPackageJson(packageRoot);
  packageJson.name = options.name ?? packageJson.name;
  packageJson.version = options.version ?? packageJson.version;
  if (options.dependencies) packageJson.dependencies = options.dependencies;
  const manifest = packageJson.tower as CliPluginManifestV1;
  if (options.permissions) manifest.permissions = options.permissions;
  await writePackageJson(packageRoot, packageJson);
  await syncProviderManifest(packageRoot);
  return packageRoot;
}

class FixtureNpmProvider implements NpmPackageProvider {
  readonly sources = new Map<string, string>();
  readonly integrity = new Map<string, string>();
  resolveCalls = 0;
  stageCalls = 0;

  add(version: string, packageRoot: string, integrity = fixtureIntegrity(version)): void {
    this.sources.set(version, packageRoot);
    this.integrity.set(version, integrity);
  }

  async resolve(packageName: string, version: string): Promise<NpmPackageResolution> {
    this.resolveCalls += 1;
    if (!this.sources.has(version)) throw new Error("missing fixture");
    return {
      packageName,
      version,
      integrity: this.integrity.get(version)!,
      tarballUrl: `memory:${version}`,
      registry: "https://registry.invalid",
    };
  }

  async stage(resolution: NpmPackageResolution, destination: string): Promise<void> {
    this.stageCalls += 1;
    await fs.cp(this.sources.get(resolution.version)!, destination, { recursive: true });
  }
}

class FailingAtomicFileSystem extends NodePluginFileSystem {
  failNextAtomicWrite = false;

  override async atomicWrite(filePath: string, data: string): Promise<void> {
    if (this.failNextAtomicWrite) {
      this.failNextAtomicWrite = false;
      throw new Error("injected atomic write failure");
    }
    await super.atomicWrite(filePath, data);
  }
}

interface TestGate {
  reached: Promise<void>;
  release(): void;
  markReached(): void;
  waitForRelease: Promise<void>;
}

function testGate(): TestGate {
  let markReached!: () => void;
  let release!: () => void;
  return {
    reached: new Promise<void>((resolve) => { markReached = resolve; }),
    waitForRelease: new Promise<void>((resolve) => { release = resolve; }),
    markReached,
    release,
  };
}

class PausingInstallFileSystem extends NodePluginFileSystem {
  private gate: TestGate | null = null;

  pauseNextInstallCommit(): TestGate {
    this.gate = testGate();
    return this.gate;
  }

  override async rename(from: string, to: string): Promise<void> {
    await super.rename(from, to);
    const gate = this.gate;
    if (gate
      && path.basename(from) === "package"
      && path.basename(path.dirname(from)).startsWith(".install-")) {
      this.gate = null;
      gate.markReached();
      await gate.waitForRelease;
    }
  }
}

class PausingLockFileSystem extends NodePluginFileSystem {
  private gate: TestGate | null = null;

  pauseNextRegistryLock(): TestGate {
    this.gate = testGate();
    return this.gate;
  }

  override async acquireLock(filePath: string): Promise<() => Promise<void>> {
    const gate = this.gate;
    if (gate) {
      this.gate = null;
      gate.markReached();
      await gate.waitForRelease;
    }
    return super.acquireLock(filePath);
  }
}

function host(): CliHostContext {
  return {
    platform: process.platform as "darwin" | "linux" | "win32",
    arch: process.arch,
    storageDir: path.join(os.tmpdir(), "tower-plugin-storage"),
    signal: new AbortController().signal,
    process: {
      execute: async () => ({
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
      }),
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

function runtime(dataRoot: string, npmProvider?: NpmPackageProvider): CliPluginRuntime {
  return new CliPluginRuntime({ dataRoot, towerVersion: "0.3.0", npmProvider });
}

afterEach(async () => {
  delete globalThis.__towerFixtureLoads;
  delete globalThis.__invalidFixtureExecuted;
  delete globalThis.__towerInvalidExportLoads;
  delete globalThis.__towerInvalidAdapterLoads;
  await Promise.all(temporaryRoots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("CLI plugin installation runtime", () => {
  it("installs an exact npm version disabled and imports only after matching permission confirmation", async () => {
    const dataRoot = await temporaryDirectory();
    const pluginRoot = await createFixture();
    const provider = new FixtureNpmProvider();
    provider.add("1.0.0", pluginRoot);
    const plugins = runtime(dataRoot, provider);

    expect(globalThis.__towerFixtureLoads).toBeUndefined();
    const plan = await plugins.planNpmInstall("@fixture/tower-cli", "1.0.0");
    expect(plan.permissions).toEqual({
      requested: ["process:spawn"],
      added: ["process:spawn"],
      removed: [],
    });
    expect(globalThis.__towerFixtureLoads).toBeUndefined();

    const installed = await plugins.installNpm(JSON.parse(JSON.stringify(plan)));
    expect(installed.enabled).toBe(false);
    expect(installed.permissionConfirmation).toBeNull();
    expect(installed.integrity).toBe(fixtureIntegrity("1.0.0"));
    await expect(plugins.load(installed.id, host())).rejects.toMatchObject({ code: "PLUGIN_DISABLED" });
    expect(globalThis.__towerFixtureLoads).toBeUndefined();

    await plugins.registry.update(installed.id, (current) => ({ ...current, enabled: true }));
    await expect(plugins.load(installed.id, host())).rejects.toMatchObject({
      code: "PERMISSION_CONFIRMATION_REQUIRED",
    });
    await plugins.disable(installed.id);

    const tampered = { ...plan, integrity: "sha512-tampered" };
    await expect(plugins.confirmAndEnable(installed.id, tampered)).rejects.toMatchObject({
      code: "INSTALL_PLAN_MISMATCH",
    });
    await plugins.confirmAndEnable(installed.id, JSON.parse(JSON.stringify(plan)));
    const adapter = await plugins.load(installed.id, host());
    expect(await adapter.generate({ prompt: "hello" })).toEqual({ text: "fixture-ok" });
    expect(globalThis.__towerFixtureLoads).toBe(1);
    await plugins.uninstall(installed.id);
    expect(await plugins.get(installed.id)).toBeNull();
    await expect(fs.access(installed.installPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["latest", "^1.0.0", "1.x", "v1.0.0", "1.0"])(
    "rejects non-exact npm version %s before registry access",
    async (version) => {
      const provider = new FixtureNpmProvider();
      const plugins = runtime(await temporaryDirectory(), provider);
      await expect(plugins.planNpmInstall("@fixture/tower-cli", version)).rejects.toMatchObject({
        code: "INVALID_PACKAGE_VERSION",
      });
      expect(provider.resolveCalls).toBe(0);
    },
  );

  it("rejects malformed manifests and schemas before executing provider code", async () => {
    const packageRoot = await createFixture();
    const packageJson = await readPackageJson(packageRoot);
    (packageJson.tower as Record<string, unknown>).kind = "api-provider";
    await writePackageJson(packageRoot, packageJson);
    await fs.writeFile(path.join(packageRoot, "provider.js"), "globalThis.__invalidFixtureExecuted = true;");
    const plugins = runtime(await temporaryDirectory());
    await expect(plugins.planLocalRegistration(packageRoot)).rejects.toMatchObject({ code: "INVALID_MANIFEST" });
    expect(globalThis.__invalidFixtureExecuted).toBeUndefined();

    const schemaRoot = await createFixture();
    const schema = JSON.parse(await fs.readFile(path.join(schemaRoot, "config.schema.json"), "utf8"));
    schema.properties.profile["x-react"] = { component: "Injected" };
    await fs.writeFile(path.join(schemaRoot, "config.schema.json"), JSON.stringify(schema));
    await expect(plugins.planLocalRegistration(schemaRoot)).rejects.toMatchObject({
      code: "INVALID_CONFIG_SCHEMA",
    });

    const incompatibleRoot = await createFixture();
    const incompatiblePackage = await readPackageJson(incompatibleRoot);
    ((incompatiblePackage.tower as CliPluginManifestV1).compatibility).node = ">=999";
    await writePackageJson(incompatibleRoot, incompatiblePackage);
    await expect(plugins.planLocalRegistration(incompatibleRoot)).rejects.toMatchObject({
      code: "INCOMPATIBLE_PLUGIN",
    });

    const escapingRoot = await createFixture();
    const escapingPackage = await readPackageJson(escapingRoot);
    escapingPackage.exports = { "./tower-cli-provider": { import: ".\\..\\outside.js" } };
    await writePackageJson(escapingRoot, escapingPackage);
    await expect(plugins.planLocalRegistration(escapingRoot)).rejects.toMatchObject({ code: "ENTRY_ESCAPE" });
  });

  it("accepts import-only ESM dependencies and rejects missing or native modules", async () => {
    const dependencyRoot = await createFixture({ dependencies: { "fixture-dependency": "1.0.0" } });
    const dependency = path.join(dependencyRoot, "node_modules", "fixture-dependency");
    await fs.mkdir(dependency, { recursive: true });
    await fs.writeFile(path.join(dependency, "package.json"), JSON.stringify({
      name: "fixture-dependency",
      version: "1.0.0",
      type: "module",
      exports: { import: "./index.js" },
    }));
    await fs.writeFile(path.join(dependency, "index.js"), "export default true;");
    const providerEntry = path.join(dependencyRoot, "provider.js");
    await fs.writeFile(providerEntry, `import "fixture-dependency";\n${await fs.readFile(providerEntry, "utf8")}`);
    const provider = new FixtureNpmProvider();
    provider.add("1.0.0", dependencyRoot);
    const plugins = runtime(await temporaryDirectory(), provider);
    const plan = await plugins.planNpmInstall("@fixture/tower-cli", "1.0.0");
    expect(plan).toMatchObject({
      pluginId: "@fixture/tower-cli",
    });
    await plugins.installNpm(plan);
    await plugins.confirmAndEnable(plan.pluginId, plan);
    await expect(plugins.load(plan.pluginId, host())).resolves.toBeDefined();

    await fs.rm(dependency, { recursive: true });
    await expect(plugins.planNpmInstall("@fixture/tower-cli", "1.0.0")).rejects.toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
    });

    const nativeRoot = await createFixture();
    await fs.writeFile(path.join(nativeRoot, "binding.node"), "not-native");
    await expect(plugins.planLocalRegistration(nativeRoot)).rejects.toMatchObject({
      code: "NATIVE_MODULE_REJECTED",
    });
  });

  it("disables an enabled plugin when an upgrade adds permissions", async () => {
    const dataRoot = await temporaryDirectory();
    const provider = new FixtureNpmProvider();
    provider.add("1.0.0", await createFixture({ version: "1.0.0" }));
    provider.add("2.0.0", await createFixture({
      version: "2.0.0",
      permissions: ["process:spawn", "network:provider"],
    }));
    provider.add("3.0.0", await createFixture({
      version: "3.0.0",
      permissions: ["process:spawn", "network:provider"],
    }));
    const plugins = runtime(dataRoot, provider);
    const firstPlan = await plugins.planNpmInstall("@fixture/tower-cli", "1.0.0");
    await plugins.installNpm(firstPlan);
    await plugins.confirmAndEnable(firstPlan.pluginId, firstPlan);

    const upgradePlan = await plugins.planNpmInstall("@fixture/tower-cli", "2.0.0");
    expect(upgradePlan.permissions.added).toEqual(["network:provider"]);
    const upgraded = await plugins.installNpm(upgradePlan);
    expect(upgraded.enabled).toBe(false);
    expect(upgraded.permissionConfirmation).toBeNull();
    await expect(plugins.load(upgraded.id, host())).rejects.toMatchObject({ code: "PLUGIN_DISABLED" });

    await plugins.confirmAndEnable(upgraded.id, upgradePlan);
    const compatibleUpgradePlan = await plugins.planNpmInstall("@fixture/tower-cli", "3.0.0");
    expect(compatibleUpgradePlan.permissions.added).toEqual([]);
    const compatibleUpgrade = await plugins.installNpm(compatibleUpgradePlan);
    expect(compatibleUpgrade.enabled).toBe(true);
    expect(compatibleUpgrade.permissionConfirmation?.permissions).toEqual([
      "network:provider",
      "process:spawn",
    ]);
  });

  it("preserves the old install and registration when staged upgrade validation fails", async () => {
    const dataRoot = await temporaryDirectory();
    const provider = new FixtureNpmProvider();
    provider.add("1.0.0", await createFixture({ version: "1.0.0" }));
    const secondRoot = await createFixture({ version: "2.0.0" });
    provider.add("2.0.0", secondRoot);
    const plugins = runtime(dataRoot, provider);
    const firstPlan = await plugins.planNpmInstall("@fixture/tower-cli", "1.0.0");
    const first = await plugins.installNpm(firstPlan);

    const upgradePlan = await plugins.planNpmInstall("@fixture/tower-cli", "2.0.0");
    const secondPackage = await readPackageJson(secondRoot);
    (secondPackage.tower as Record<string, unknown>).apiVersion = "99.0";
    await writePackageJson(secondRoot, secondPackage);
    await expect(plugins.installNpm(upgradePlan)).rejects.toMatchObject({ code: "INCOMPATIBLE_PLUGIN" });
    const after = await plugins.get(first.id);
    expect(after).toMatchObject({ version: "1.0.0", installPath: first.installPath });
    expect(await readPackageJson(first.installPath)).toMatchObject({ version: "1.0.0" });
  });

  it("rolls back a staged directory when the atomic registry switch fails", async () => {
    const dataRoot = await temporaryDirectory();
    const provider = new FixtureNpmProvider();
    provider.add("1.0.0", await createFixture({ version: "1.0.0" }));
    provider.add("2.0.0", await createFixture({ version: "2.0.0" }));
    const fileSystem = new FailingAtomicFileSystem();
    const plugins = new CliPluginRuntime({
      dataRoot,
      towerVersion: "0.3.0",
      npmProvider: provider,
      fileSystem,
    });
    const firstPlan = await plugins.planNpmInstall("@fixture/tower-cli", "1.0.0");
    const first = await plugins.installNpm(firstPlan);
    const upgradePlan = await plugins.planNpmInstall("@fixture/tower-cli", "2.0.0");

    fileSystem.failNextAtomicWrite = true;
    await expect(plugins.installNpm(upgradePlan)).rejects.toMatchObject({ code: "INSTALL_FAILED" });
    expect(await plugins.get(first.id)).toMatchObject({ version: "1.0.0", installPath: first.installPath });
    expect(await readPackageJson(first.installPath)).toMatchObject({ version: "1.0.0" });
    expect((await fs.readdir(path.dirname(first.installPath))).filter((entry) => entry.startsWith("2.0.0-")))
      .toEqual([]);
  });

  it("registers local directories without copying and only removes the registration", async () => {
    const packageRoot = await createFixture();
    const plugins = runtime(await temporaryDirectory());
    const plan = await plugins.planLocalRegistration(packageRoot);
    const registered = await plugins.registerLocal(plan);
    expect(registered.source).toBe("local");
    expect(registered.installPath).toBe(await fs.realpath(packageRoot));
    expect(registered.enabled).toBe(false);
    await plugins.confirmAndEnable(registered.id, plan);
    expect((await plugins.load(registered.id, host())).models()).resolves.toEqual([{ id: "fixture" }]);
    await plugins.uninstall(registered.id);
    expect(await plugins.get(registered.id)).toBeNull();
    expect((await fs.stat(packageRoot)).isDirectory()).toBe(true);
  });

  it("detects damaged installed files with a stable path-free error", async () => {
    const packageRoot = await createFixture();
    const plugins = runtime(await temporaryDirectory());
    const plan = await plugins.planLocalRegistration(packageRoot);
    await plugins.registerLocal(plan);
    await plugins.confirmAndEnable(plan.pluginId, plan);
    await fs.writeFile(path.join(packageRoot, "provider.js"), "export const changed = true;");
    const error = await plugins.load(plan.pluginId, host()).catch((caught) => caught);
    expect(error).toMatchObject({ code: "PLUGIN_CORRUPT", message: "Installed plugin files do not match the registry" });
    expect(error.message).not.toContain(packageRoot);
  });

  it("reports an invalid standard export only after confirmed lazy loading", async () => {
    const packageRoot = await createFixture();
    await fs.writeFile(path.join(packageRoot, "provider.js"), `
globalThis.__towerInvalidExportLoads = (globalThis.__towerInvalidExportLoads ?? 0) + 1;
export const notTowerCliPlugin = {};
`);
    const plugins = runtime(await temporaryDirectory());
    const plan = await plugins.planLocalRegistration(packageRoot);
    await plugins.registerLocal(plan);
    await expect(plugins.load(plan.pluginId, host())).rejects.toMatchObject({ code: "PLUGIN_DISABLED" });
    expect(globalThis.__towerInvalidExportLoads).toBeUndefined();

    await plugins.confirmAndEnable(plan.pluginId, plan);
    const error = await plugins.load(plan.pluginId, host()).catch((caught) => caught);
    expect(error).toMatchObject({
      code: "INVALID_PLUGIN_EXPORT",
      message: "Plugin module does not expose the standard CLI provider export",
    });
    expect(error.message).not.toContain(packageRoot);
    expect(globalThis.__towerInvalidExportLoads).toBe(1);
  });

  it("reports an invalid adapter shape with a stable path-free error", async () => {
    const packageRoot = await createFixture();
    const packageJson = await readPackageJson(packageRoot);
    await fs.writeFile(path.join(packageRoot, "provider.js"), `
globalThis.__towerInvalidAdapterLoads = (globalThis.__towerInvalidAdapterLoads ?? 0) + 1;
export const towerCliPlugin = {
  manifest: ${JSON.stringify(packageJson.tower)},
  createAdapter() { return {}; }
};
`);
    const plugins = runtime(await temporaryDirectory());
    const plan = await plugins.planLocalRegistration(packageRoot);
    await plugins.registerLocal(plan);
    await plugins.confirmAndEnable(plan.pluginId, plan);

    const error = await plugins.load(plan.pluginId, host()).catch((caught) => caught);
    expect(error).toMatchObject({ code: "INVALID_ADAPTER", message: "Plugin returned an invalid CLI adapter" });
    expect(error.message).not.toContain(packageRoot);
    expect(globalThis.__towerInvalidAdapterLoads).toBe(1);
  });
});

describe("plugin registry durability", () => {
  it("serializes concurrent writers across runtime instances without losing registrations", async () => {
    const dataRoot = await temporaryDirectory();
    const packages = await Promise.all(Array.from({ length: 6 }, (_, index) => createFixture({
      name: `@fixture/plugin-${index}`,
    })));
    const runtimes = packages.map(() => runtime(dataRoot));
    const plans = await Promise.all(packages.map((packageRoot, index) => runtimes[index].planLocalRegistration(packageRoot)));
    await Promise.all(plans.map((plan, index) => runtimes[index].registerLocal(plan)));
    expect((await runtime(dataRoot).list()).map((plugin) => plugin.id)).toEqual(
      Array.from({ length: 6 }, (_, index) => `@fixture/plugin-${index}`),
    );
  });

  it("rejects a stale same-plugin install after another runtime commits the winner", async () => {
    const dataRoot = await temporaryDirectory();
    const provider = new FixtureNpmProvider();
    provider.add("1.0.0", await createFixture({ version: "1.0.0" }));
    provider.add("2.0.0", await createFixture({ version: "2.0.0" }));
    const replacementPackage = await createFixture({ version: "1.0.0" });
    const pausingFileSystem = new PausingInstallFileSystem();
    const staleRuntime = new CliPluginRuntime({
      dataRoot,
      towerVersion: "0.3.0",
      npmProvider: provider,
      fileSystem: pausingFileSystem,
    });
    const winnerRuntime = runtime(dataRoot, provider);
    const initialPlan = await winnerRuntime.planNpmInstall("@fixture/tower-cli", "1.0.0");
    const initial = await winnerRuntime.installNpm(initialPlan);
    const stalePlan = await staleRuntime.planNpmInstall(initial.id, "2.0.0");
    const winnerPlan = await winnerRuntime.planLocalRegistration(replacementPackage);

    const gate = pausingFileSystem.pauseNextInstallCommit();
    const staleInstall = staleRuntime.installNpm(stalePlan);
    await gate.reached;
    const winner = await winnerRuntime.registerLocal(winnerPlan);
    gate.release();

    await expect(staleInstall).rejects.toMatchObject({ code: "INSTALL_PLAN_MISMATCH" });
    expect(await winnerRuntime.get(initial.id)).toMatchObject({
      source: "local",
      version: "1.0.0",
      installPath: winner.installPath,
    });
    expect((await fs.readdir(path.dirname(initial.installPath))).some((entry) => entry.startsWith("2.0.0-")))
      .toBe(false);
  });

  it("rejects a stale local registration after another runtime commits the winner", async () => {
    const dataRoot = await temporaryDirectory();
    const stalePackage = await createFixture({ version: "1.0.0" });
    const winnerPackage = await createFixture({ version: "2.0.0" });
    const pausingFileSystem = new PausingLockFileSystem();
    const staleRuntime = new CliPluginRuntime({
      dataRoot,
      towerVersion: "0.3.0",
      fileSystem: pausingFileSystem,
    });
    const winnerRuntime = runtime(dataRoot);
    const stalePlan = await staleRuntime.planLocalRegistration(stalePackage);
    const winnerPlan = await winnerRuntime.planLocalRegistration(winnerPackage);

    const gate = pausingFileSystem.pauseNextRegistryLock();
    const staleRegistration = staleRuntime.registerLocal(stalePlan);
    await gate.reached;
    const winner = await winnerRuntime.registerLocal(winnerPlan);
    gate.release();

    await expect(staleRegistration).rejects.toMatchObject({ code: "INSTALL_PLAN_MISMATCH" });
    expect(await winnerRuntime.get(winner.id)).toMatchObject({
      version: "2.0.0",
      installPath: winner.installPath,
    });
  });

  it("prevents an old confirmation from enabling a concurrent permission upgrade", async () => {
    const dataRoot = await temporaryDirectory();
    const provider = new FixtureNpmProvider();
    provider.add("1.0.0", await createFixture({ version: "1.0.0" }));
    provider.add("2.0.0", await createFixture({
      version: "2.0.0",
      permissions: ["process:spawn", "network:provider"],
    }));
    const pausingFileSystem = new PausingLockFileSystem();
    const confirmingRuntime = new CliPluginRuntime({
      dataRoot,
      towerVersion: "0.3.0",
      npmProvider: provider,
      fileSystem: pausingFileSystem,
    });
    const upgradingRuntime = runtime(dataRoot, provider);
    const firstPlan = await upgradingRuntime.planNpmInstall("@fixture/tower-cli", "1.0.0");
    await upgradingRuntime.installNpm(firstPlan);
    const upgradePlan = await upgradingRuntime.planNpmInstall(firstPlan.pluginId, "2.0.0");

    const gate = pausingFileSystem.pauseNextRegistryLock();
    const oldConfirmation = confirmingRuntime.confirmAndEnable(firstPlan.pluginId, firstPlan);
    await gate.reached;
    await upgradingRuntime.installNpm(upgradePlan);
    gate.release();

    await expect(oldConfirmation).rejects.toMatchObject({ code: "INSTALL_PLAN_MISMATCH" });
    expect(await upgradingRuntime.get(firstPlan.pluginId)).toMatchObject({
      version: "2.0.0",
      enabled: false,
      permissionConfirmation: null,
      permissions: ["network:provider", "process:spawn"],
    });
  });

  it("does not uninstall a registration replaced concurrently by another runtime", async () => {
    const dataRoot = await temporaryDirectory();
    const provider = new FixtureNpmProvider();
    provider.add("1.0.0", await createFixture({ version: "1.0.0" }));
    provider.add("2.0.0", await createFixture({ version: "2.0.0" }));
    const pausingFileSystem = new PausingLockFileSystem();
    const uninstallingRuntime = new CliPluginRuntime({
      dataRoot,
      towerVersion: "0.3.0",
      npmProvider: provider,
      fileSystem: pausingFileSystem,
    });
    const upgradingRuntime = runtime(dataRoot, provider);
    const firstPlan = await upgradingRuntime.planNpmInstall("@fixture/tower-cli", "1.0.0");
    await upgradingRuntime.installNpm(firstPlan);
    const upgradePlan = await upgradingRuntime.planNpmInstall(firstPlan.pluginId, "2.0.0");

    const gate = pausingFileSystem.pauseNextRegistryLock();
    const staleUninstall = uninstallingRuntime.uninstall(firstPlan.pluginId);
    await gate.reached;
    const winner = await upgradingRuntime.installNpm(upgradePlan);
    gate.release();

    await expect(staleUninstall).rejects.toMatchObject({ code: "UNINSTALL_FAILED" });
    expect(await upgradingRuntime.get(firstPlan.pluginId)).toMatchObject({
      version: "2.0.0",
      installPath: winner.installPath,
    });
    await expect(fs.access(winner.installPath)).resolves.toBeUndefined();
  });

  it("reports a corrupt registry and explicitly recovers it to a versioned empty registry", async () => {
    const dataRoot = await temporaryDirectory();
    const registry = new PluginRegistry({ dataRoot });
    await registry.initialize();
    await fs.writeFile(registry.registryPath, "{broken");
    await expect(registry.list()).rejects.toMatchObject({ code: "REGISTRY_CORRUPT" });
    const recovery = await registry.recover();
    expect(recovery).toMatchObject({ recovered: true });
    expect(recovery.backupFileName).toMatch(/^registry\.v1\.corrupt\.\d+\.json$/);
    expect(await registry.list()).toEqual([]);
  });
});

describe("npm package safety", () => {
  it("verifies registry integrity and installs production dependencies with lifecycle scripts disabled", async () => {
    const root = await temporaryDirectory();
    const archiveRoot = path.join(root, "archive");
    const packageRoot = path.join(archiveRoot, "package");
    await fs.cp(fixtureRoot, packageRoot, { recursive: true });
    const tarball = path.join(root, "plugin.tgz");
    const tarModule = await import("tar");
    await tarModule.c({ gzip: true, cwd: archiveRoot, file: tarball }, ["package"]);
    const contents = await fs.readFile(tarball);
    const integrity = `sha512-${createHash("sha512").update(contents).digest("base64")}`;
    const commandRunner = vi.fn<PackageCommandRunner>(async (_command, args, options) => {
      expect(args).toEqual(expect.arrayContaining(["--omit=dev", "--ignore-scripts", "--package-lock=false"]));
      expect(options.env.npm_config_ignore_scripts).toBe("true");
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(encodeURIComponent("@fixture/tower-cli"))) {
        return new Response(JSON.stringify({
          versions: {
            "1.0.0": { dist: { integrity, tarball: "https://tarball.invalid/plugin.tgz" } },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(contents, {
        status: 200,
        headers: { "content-length": String(contents.byteLength) },
      });
    });
    const provider = new DefaultNpmPackageProvider({
      registry: "https://registry.invalid",
      fetch: fetchMock as typeof fetch,
      commandRunner,
      fileSystem: new NodePluginFileSystem(),
    });
    const resolution = await provider.resolve("@fixture/tower-cli", "1.0.0");
    expect(resolution.integrity).toBe(integrity);
    const destination = path.join(root, "staged");
    await provider.stage(resolution, destination);
    expect(commandRunner).toHaveBeenCalledOnce();
    await expect(fs.access(path.join(destination, "script-ran"))).rejects.toMatchObject({ code: "ENOENT" });

    await expect(provider.stage({ ...resolution, integrity: "sha512-AAAA" }, path.join(root, "bad")))
      .rejects.toMatchObject({ code: "INTEGRITY_MISMATCH" });
  });

  it.each([
    "../escape",
    "package/../escape",
    "package\\..\\escape",
    "/absolute",
    "C:\\absolute\\file",
    "\\\\server\\share\\file",
  ])("rejects unsafe Unix/Windows archive path %s", (unsafePath) => {
    expect(() => assertSafeArchivePath(unsafePath)).toThrowError(expect.objectContaining({ code: "UNSAFE_ARCHIVE" }));
  });

  it.each(["./../entry.js", ".\\..\\entry.js", "C:\\entry.js", "./C:\\entry.js", "./dir/../../entry.js"])(
    "rejects unsafe package-relative path %s",
    (unsafePath) => expect(isSafePackageRelativePath(unsafePath)).toBe(false),
  );
});
