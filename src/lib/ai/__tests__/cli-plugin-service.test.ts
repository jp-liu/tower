// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CliPluginRuntime,
  FixtureExtensionCatalog,
  PluginRuntimeError,
  type CliDependencyDiagnostic,
  type CliDependencyVerifier,
  type ExtensionArtifactProvider,
  type ExtensionCatalogIndexV1,
  type NpmPackageProvider,
} from "@tower/ai-runtime";
import { db } from "@/lib/db";
import { CliPluginApplication, getCliPluginApplication } from "../cli-plugin-service";
import { CLI_SECRET_MASK } from "../cli-plugin-shared";
import { testPluginCliConnection } from "../cli-plugin-provider";
import { generateCapabilityText } from "../capability-executor";
import { resolveQueryAdapter, resolveTerminalTargetPlan } from "../capability-resolver";
import { buildTerminalLaunch, terminalTargetSnapshot } from "../terminal-target";
import { providerRegistry } from "../providers";
import { isWindows } from "@/lib/platform";

vi.mock("server-only", () => ({}));

const fixtureRoot = fileURLToPath(
  new URL("../../../../packages/ai-runtime/test/fixtures/valid-plugin", import.meta.url),
);
const temporaryRoots: string[] = [];
const packageName = "@fixture/app-service-cli";
const pluginId = "fixture.tower-cli";
const fixtureIntegrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;

function readyVerifier(): CliDependencyVerifier {
  return {
    verify: async (manifest) => ({
      dependency: manifest.cliDependency.name,
      state: "ready",
      commandPath: "/opt/fixture-cli",
      detectedVersion: "1.2.3",
      supportedVersions: manifest.cliDependency.supportedVersions,
      homepage: manifest.cliDependency.homepage,
      installDocs: manifest.cliDependency.installDocs,
      managedByTower: false,
    }),
  };
}

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-app-"));
  temporaryRoots.push(root);
  const packageRoot = path.join(root, "plugin");
  await fs.cp(fixtureRoot, packageRoot, { recursive: true });
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  packageJson.name = packageName;
  packageJson.tower.compatibility.tower = ">=0.3.0 <1.0.0";
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  const configSchema = JSON.parse(await fs.readFile(path.join(packageRoot, "config.schema.json"), "utf8"));
  configSchema.properties.profile.default = "default-profile";
  configSchema.properties.profile["x-tower"].sensitive = true;
  configSchema.properties.retries = {
    type: "integer",
    enum: [1, 2, 3],
    default: 1,
    "x-tower": { control: "select", order: 2 },
  };
  await fs.writeFile(path.join(packageRoot, "config.schema.json"), JSON.stringify(configSchema));
  return packageRoot;
}

afterEach(async () => {
  await db.aiCapabilityConfig.deleteMany({ where: { slot: "plugin-service-test" } });
  await db.providerConnection.deleteMany({ where: { provider: pluginId } });
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("CLI plugin application lifecycle", () => {
  it("discovers, searches, plans, and installs a catalog provider disabled before permission review", async () => {
    const source = await fixture();
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-catalog-data-"));
    temporaryRoots.push(dataRoot);
    const ready: CliDependencyDiagnostic = {
      dependency: "Fixture CLI",
      state: "ready",
      commandPath: "/opt/fixture-cli",
      detectedVersion: "1.2.3",
      supportedVersions: ">=1.0.0 <2.0.0",
      homepage: "https://example.com/fixture-cli",
      installDocs: "https://example.com/fixture-cli/install",
      managedByTower: false,
    };
    let dependency = ready;
    const verifier: CliDependencyVerifier = {
      verify: vi.fn(async () => {
        if (dependency.state === "ready") return dependency;
        throw new PluginRuntimeError(
          "CLI_DEPENDENCY_UNAVAILABLE",
          "fixture dependency unavailable",
          { diagnostic: dependency },
        );
      }),
    };
    const artifactProvider: ExtensionArtifactProvider = {
      stage: async (_artifact, destination) => fs.cp(source, destination, { recursive: true }),
    };
    const catalogDocument: ExtensionCatalogIndexV1 = {
      schemaVersion: 1,
      extensions: [{
        id: pluginId,
        kind: "cli-provider",
        publisher: { id: "fixture-labs", name: "Fixture Labs" },
        display: {
          name: "Fixture CLI",
          description: "Fixture community provider",
          homepage: "https://example.com/fixture-cli",
        },
        versions: [{
          version: "1.0.0",
          artifact: {
            url: "https://catalog.example.test/fixture-cli-1.0.0.tgz",
            sha256: "1".repeat(64),
            size: 1,
          },
          cliDependency: {
            name: "Fixture CLI",
            supportedVersions: ">=1.0.0 <2.0.0",
            installDocs: "https://example.com/fixture-cli/install",
          },
        }],
      }],
    };
    const application = new CliPluginApplication({
      dataRoot,
      catalog: new FixtureExtensionCatalog(catalogDocument),
      runtime: new CliPluginRuntime({
        dataRoot,
        towerVersion: "0.3.0",
        artifactProvider,
        cliDependencyVerifier: verifier,
      }),
    });

    await expect(application.listCatalog("no match")).resolves.toEqual([]);
    await expect(application.listCatalog("fixture labs")).resolves.toMatchObject([{
      id: pluginId,
      latestVersion: "1.0.0",
      installed: null,
      updateAvailable: false,
    }]);
    const plan = await application.planCatalog(pluginId, "1.0.0");
    expect(plan).toMatchObject({
      source: "catalog",
      publisher: { id: "fixture-labs", name: "Fixture Labs" },
      cliDependency: { name: "Fixture CLI", command: "fixture-cli", managedByTower: false },
      dependency: { state: "ready", detectedVersion: "1.2.3" },
    });
    await expect(application.install(plan.planDigest)).resolves.toMatchObject({
      id: pluginId,
      enabled: false,
      permissionConfirmed: false,
      health: "disabled",
    });
    await expect(application.listCatalog()).resolves.toMatchObject([{
      installed: { id: pluginId, enabled: false },
    }]);

    dependency = { ...ready, state: "version-incompatible", detectedVersion: "2.0.0" };
    await expect(application.confirmAndEnable(plan.planDigest)).rejects.toMatchObject({
      code: "cli_incompatible",
      diagnostic: { state: "version-incompatible", detectedVersion: "2.0.0" },
    });
    dependency = ready;
    await expect(application.confirmAndEnable(plan.planDigest)).resolves.toMatchObject({
      enabled: true,
      permissionConfirmed: true,
    });
    await application.uninstall(pluginId);
    expect(await application.runtime.get(pluginId)).toBeNull();
  });

  it("returns a structured dependency diagnostic without exposing catalog transport details", async () => {
    const source = await fixture();
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-catalog-missing-"));
    temporaryRoots.push(dataRoot);
    const missing: CliDependencyDiagnostic = {
      dependency: "Fixture CLI",
      state: "missing",
      commandPath: null,
      detectedVersion: null,
      supportedVersions: ">=1.0.0 <2.0.0",
      homepage: "https://example.com/fixture-cli",
      installDocs: "https://example.com/fixture-cli/install",
      managedByTower: false,
    };
    const catalog = new FixtureExtensionCatalog({
      schemaVersion: 1,
      extensions: [{
        id: pluginId,
        kind: "cli-provider",
        publisher: { id: "fixture-labs", name: "Fixture Labs" },
        display: { name: "Fixture CLI" },
        versions: [{
          version: "1.0.0",
          artifact: {
            url: "https://private-catalog.example.test/secret-path.tgz",
            sha256: "2".repeat(64),
            size: 1,
          },
        }],
      }],
    });
    const runtime = new CliPluginRuntime({
      dataRoot,
      towerVersion: "0.3.0",
      artifactProvider: { stage: async (_artifact, destination) => fs.cp(source, destination, { recursive: true }) },
      cliDependencyVerifier: {
        verify: async () => {
          throw new PluginRuntimeError("CLI_DEPENDENCY_UNAVAILABLE", "missing", { diagnostic: missing });
        },
      },
    });
    const application = new CliPluginApplication({ dataRoot, runtime, catalog });

    const error = await application.planCatalog(pluginId, "1.0.0").catch((caught) => caught);
    expect(error).toMatchObject({ code: "cli_not_found", diagnostic: missing });
    expect(JSON.stringify(error)).not.toContain("private-catalog");
    expect(await runtime.get(pluginId)).toBeNull();
  });

  it("carries an unregistered local plugin through install, test, slots, Terminal, and query", async () => {
    if (isWindows()) return;
    const source = await fixture();
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-chain-data-"));
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-chain-home-"));
    const fakeBin = path.join(fakeHome, "bin");
    temporaryRoots.push(dataRoot, fakeHome);
    await fs.mkdir(fakeBin, { recursive: true });
    const executable = path.join(fakeBin, "fixture-cli");
    await fs.writeFile(executable, [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  printf 'fixture-cli 1.2.3\\n'",
      "else",
      "  printf 'hello\\n'",
      "fi",
      "",
    ].join("\n"), { mode: 0o700 });

    const originalConfigs = await db.aiCapabilityConfig.findMany({
      where: { slot: { in: ["summary", "terminal"] } },
      include: { targets: true },
    });
    vi.stubEnv("TOWER_DATA_DIR", dataRoot);
    vi.stubEnv("HOME", fakeHome);
    vi.stubEnv("PATH", `${fakeBin}${path.delimiter}/usr/bin:/bin`);

    let application: CliPluginApplication | null = null;
    try {
      application = getCliPluginApplication();
      const plan = await application.planLocal(source);
      expect(providerRegistry.get(pluginId)).toBeUndefined();
      await expect(application.install(plan.planDigest)).resolves.toMatchObject({ enabled: false });
      await expect(application.confirmAndEnable(plan.planDigest)).resolves.toMatchObject({ enabled: true });

      const connectionTest = await testPluginCliConnection(pluginId);
      expect(connectionTest).toMatchObject({ state: "connected", command: executable, models: ["fixture"] });
      const connection = await db.providerConnection.findUniqueOrThrow({ where: { connectionKey: `cli:${pluginId}` } });

      for (const slot of ["summary", "terminal"] as const) {
        const config = await db.aiCapabilityConfig.upsert({
          where: { slot },
          create: { slot, migrationStatus: "complete" },
          update: { migrationStatus: "complete" },
        });
        await db.aiCapabilityTarget.deleteMany({ where: { capabilityConfigId: config.id } });
        await db.aiCapabilityTarget.create({
          data: {
            capabilityConfigId: config.id, connectionId: connection.id, modelId: "fixture",
            targetKey: `${pluginId}:fixture`, order: 0,
          },
        });
      }

      await expect(generateCapabilityText({ slot: "summary", prompt: "fixture query", cwd: source }))
        .resolves.toBe("fixture-ok");
      const query = await resolveQueryAdapter("summary");
      await expect(query.adapter.query({ prompt: "legacy query", cwd: source, model: query.model }))
        .resolves.toMatchObject({ content: "fixture-ok" });

      const terminal = (await resolveTerminalTargetPlan({ cwd: source })).targets[0]!;
      expect(terminal.preflightError).toBeUndefined();
      expect(terminalTargetSnapshot(terminal)).toMatchObject({ connectionId: connection.id, modelId: "fixture" });
      const launch = await buildTerminalLaunch(terminal, {
        cwd: source, prompt: "terminal prompt", model: "fixture", mode: { type: "fresh" },
      });
      expect(launch.processSpec).toMatchObject({
        command: executable,
        args: ["terminal prompt"],
      });
    } finally {
      for (const current of await db.aiCapabilityConfig.findMany({
        where: { slot: { in: ["summary", "terminal"] } },
      })) {
        await db.aiCapabilityTarget.deleteMany({ where: { capabilityConfigId: current.id } });
      }
      for (const config of originalConfigs) {
        await db.aiCapabilityConfig.upsert({
          where: { slot: config.slot },
          create: {
            id: config.id, slot: config.slot, provider: config.provider, mode: config.mode,
            model: config.model, migrationStatus: config.migrationStatus,
          },
          update: {
            provider: config.provider, mode: config.mode, model: config.model,
            migrationStatus: config.migrationStatus,
          },
        });
        for (const target of config.targets) {
          await db.aiCapabilityTarget.create({
            data: {
              id: target.id, capabilityConfigId: config.id, connectionId: target.connectionId,
              modelId: target.modelId, targetKey: target.targetKey, order: target.order,
            },
          });
        }
      }
      if (application) await application.uninstall(pluginId).catch(() => undefined);
      vi.unstubAllEnvs();
    }
  }, 180_000);

  it("executes the npm plan, disabled install, permission confirmation, and uninstall lifecycle", async () => {
    const source = await fixture();
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-npm-data-"));
    temporaryRoots.push(dataRoot);
    const npmProvider: NpmPackageProvider = {
      resolve: async (packageName, version) => ({
        packageName,
        version,
        integrity: fixtureIntegrity,
        registry: "https://registry.invalid",
        tarballUrl: "https://registry.invalid/plugin.tgz",
      }),
      stage: async (_resolution, destination) => fs.cp(source, destination, { recursive: true }),
    };
    const application = new CliPluginApplication({
      dataRoot,
      runtime: new CliPluginRuntime({
        dataRoot,
        towerVersion: "0.3.0",
        npmProvider,
        cliDependencyVerifier: readyVerifier(),
      }),
    });

    const plan = await application.planNpm(packageName, "1.0.0");
    expect(plan).toMatchObject({ source: "npm", pluginId, toVersion: "1.0.0" });
    await expect(application.install(plan.planDigest)).resolves.toMatchObject({ enabled: false });
    const restarted = new CliPluginApplication({
      dataRoot,
      runtime: new CliPluginRuntime({
        dataRoot,
        towerVersion: "0.3.0",
        npmProvider,
        cliDependencyVerifier: readyVerifier(),
      }),
    });
    const recoveredPlan = await restarted.reviewInstalled(pluginId);
    expect(JSON.stringify(recoveredPlan)).not.toContain(dataRoot);
    await expect(restarted.install(recoveredPlan.planDigest)).resolves.toMatchObject({ enabled: false });
    await expect(restarted.confirmAndEnable(recoveredPlan.planDigest)).resolves.toMatchObject({ enabled: true });
    await restarted.uninstall(pluginId);
    expect(await restarted.runtime.get(pluginId)).toBeNull();
  });

  it("keeps plans server-side, requires install then confirmation, and preserves connection state", async () => {
    const source = await fixture();
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-data-"));
    temporaryRoots.push(dataRoot);
    let now = Date.parse("2026-07-25T00:00:00Z");
    const application = new CliPluginApplication({
      dataRoot,
      runtime: new CliPluginRuntime({
        dataRoot,
        towerVersion: "0.3.0",
        cliDependencyVerifier: readyVerifier(),
      }),
      now: () => now,
    });

    const expired = await application.planLocal(source);
    now = Date.parse(expired.expiresAt) + 1;
    await expect(application.install(expired.planDigest)).rejects.toMatchObject({ code: "plan_expired" });

    now = Date.parse("2026-07-25T00:01:00Z");
    const plan = await application.planLocal(source);
    const serializedPlan = JSON.stringify(plan);
    expect(serializedPlan).not.toContain(source);
    expect(serializedPlan).not.toContain("integrity");
    expect(plan.permissions.added).toEqual(["process:spawn"]);

    const installed = await application.install(plan.planDigest);
    expect(installed.enabled).toBe(false);
    now = Date.parse(plan.expiresAt) + 1;
    await expect(application.confirmAndEnable(plan.planDigest))
      .rejects.toMatchObject({ code: "plan_expired" });
    await expect(application.confirmAndEnable("sha256-invalid-plan-digest"))
      .rejects.toMatchObject({ code: "plan_expired" });
    const active = new CliPluginApplication({
      dataRoot,
      runtime: new CliPluginRuntime({
        dataRoot,
        towerVersion: "0.3.0",
        cliDependencyVerifier: readyVerifier(),
      }),
      now: () => now,
    });
    expect((await active.list()).find((plugin) => plugin.id === pluginId))
      .toMatchObject({ enabled: false, permissionConfirmed: false });
    const recoveredPlan = await active.reviewInstalled(pluginId);
    expect(JSON.stringify(recoveredPlan)).not.toContain(source);
    await active.install(recoveredPlan.planDigest);
    const enabled = await active.confirmAndEnable(recoveredPlan.planDigest);
    expect(enabled.enabled).toBe(true);

    const detail = await active.getConnectionDetail(pluginId);
    expect(detail.settings).toEqual({ profile: CLI_SECRET_MASK, retries: 1 });
    const secret = "CANARY_PLUGIN_SECRET_7d3f";
    const saved = await active.saveConnection({
      connectionId: detail.id,
      name: "Community CLI",
      enabled: true,
      commandOverride: "/opt/community-cli",
      baseArgs: ["--json"],
      envVars: [{ id: "env-1", name: "COMMUNITY_API_TOKEN", value: secret, enabled: true, sensitive: false }],
      settings: { profile: CLI_SECRET_MASK, retries: 2 },
    });
    expect(saved.envVars[0]).toMatchObject({ sensitive: true, value: CLI_SECRET_MASK });
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect(saved.settings.retries).toBe(2);
    const storedConnection = await db.providerConnection.findUnique({ where: { id: detail.id } });
    expect(JSON.parse(storedConnection!.settingsJson).retries).toBe(2);
    await expect(active.revealConnectionSecret(detail.id, { kind: "environment", key: "env-1" }))
      .resolves.toEqual({ value: secret });
    expect(JSON.stringify(await active.list())).not.toContain(secret);

    await active.disable(pluginId);
    const disabledConnection = await db.providerConnection.findUnique({ where: { id: detail.id } });
    expect(disabledConnection).toMatchObject({ enabled: false, testStatus: "unavailable" });
    await expect(active.enable(pluginId)).resolves.toMatchObject({ enabled: true });
    await active.disable(pluginId);
    const capability = await db.aiCapabilityConfig.create({
      data: {
        slot: "plugin-service-test",
        targets: {
          create: {
            connectionId: detail.id,
            targetKey: "plugin-target",
            order: 0,
          },
        },
      },
    });
    await active.uninstall(pluginId);
    expect(await active.runtime.get(pluginId)).toBeNull();
    expect(await db.providerConnection.findUnique({ where: { id: detail.id } })).toMatchObject({
      provider: pluginId,
      enabled: false,
    });
    expect(await db.aiCapabilityTarget.findMany({ where: { capabilityConfigId: capability.id } }))
      .toHaveLength(1);

    const reinstall = await active.planLocal(source);
    await active.install(reinstall.planDigest);
    await active.confirmAndEnable(reinstall.planDigest);
    expect(await db.providerConnection.findUnique({ where: { id: detail.id } })).toMatchObject({
      name: "Community CLI",
      enabled: true,
    });
  });

  it("keeps HMR runtime instances isolated by the active Tower data directory", async () => {
    const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-instance-a-"));
    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-instance-b-"));
    temporaryRoots.push(firstRoot, secondRoot);
    const previous = process.env.TOWER_DATA_DIR;
    try {
      process.env.TOWER_DATA_DIR = firstRoot;
      const first = getCliPluginApplication();
      process.env.TOWER_DATA_DIR = secondRoot;
      const second = getCliPluginApplication();

      expect(first).not.toBe(second);
      expect(first.dataRoot).toBe(firstRoot);
      expect(second.dataRoot).toBe(secondRoot);
      process.env.TOWER_DATA_DIR = firstRoot;
      expect(getCliPluginApplication()).toBe(first);
    } finally {
      if (previous === undefined) delete process.env.TOWER_DATA_DIR;
      else process.env.TOWER_DATA_DIR = previous;
    }
  });
});
