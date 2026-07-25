// @vitest-environment node
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliPluginRuntime, type NpmPackageProvider } from "@tower/ai-runtime";
import { db } from "@/lib/db";
import { CliPluginApplication, getCliPluginApplication } from "../cli-plugin-service";
import { CLI_SECRET_MASK } from "../cli-plugin-shared";

vi.mock("server-only", () => ({}));

const fixtureRoot = fileURLToPath(
  new URL("../../../../packages/ai-runtime/test/fixtures/valid-plugin", import.meta.url),
);
const temporaryRoots: string[] = [];
const pluginId = "@fixture/app-service-cli";
const fixtureIntegrity = `sha512-${Buffer.alloc(64, 7).toString("base64")}`;

async function fixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-app-"));
  temporaryRoots.push(root);
  const packageRoot = path.join(root, "plugin");
  await fs.cp(fixtureRoot, packageRoot, { recursive: true });
  const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  packageJson.name = pluginId;
  packageJson.tower.compatibility.tower = ">=0.3.0 <1.0.0";
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  const configSchema = JSON.parse(await fs.readFile(path.join(packageRoot, "config.schema.json"), "utf8"));
  configSchema.properties.profile.default = "default-profile";
  configSchema.properties.profile["x-tower"].sensitive = true;
  await fs.writeFile(path.join(packageRoot, "config.schema.json"), JSON.stringify(configSchema));
  return packageRoot;
}

afterEach(async () => {
  await db.aiCapabilityConfig.deleteMany({ where: { slot: "plugin-service-test" } });
  await db.providerConnection.deleteMany({ where: { provider: pluginId } });
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("CLI plugin application lifecycle", () => {
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
      runtime: new CliPluginRuntime({ dataRoot, towerVersion: "0.3.0", npmProvider }),
    });

    const plan = await application.planNpm(pluginId, "1.0.0");
    expect(plan).toMatchObject({ source: "npm", pluginId, toVersion: "1.0.0" });
    await expect(application.install(plan.planDigest)).resolves.toMatchObject({ enabled: false });
    await expect(application.confirmAndEnable(plan.planDigest)).resolves.toMatchObject({ enabled: true });
    await application.uninstall(pluginId);
    expect(await application.runtime.get(pluginId)).toBeNull();
  });

  it("keeps plans server-side, requires install then confirmation, and preserves connection state", async () => {
    const source = await fixture();
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-plugin-data-"));
    temporaryRoots.push(dataRoot);
    let now = Date.parse("2026-07-25T00:00:00Z");
    const application = new CliPluginApplication({
      dataRoot,
      runtime: new CliPluginRuntime({ dataRoot, towerVersion: "0.3.0" }),
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
    await expect(application.confirmAndEnable("sha256-invalid-plan-digest"))
      .rejects.toMatchObject({ code: "plan_expired" });
    const enabled = await application.confirmAndEnable(plan.planDigest);
    expect(enabled.enabled).toBe(true);

    const detail = await application.getConnectionDetail(pluginId);
    expect(detail.settings).toEqual({ profile: CLI_SECRET_MASK });
    const secret = "CANARY_PLUGIN_SECRET_7d3f";
    const saved = await application.saveConnection({
      connectionId: detail.id,
      name: "Community CLI",
      enabled: true,
      commandOverride: "/opt/community-cli",
      baseArgs: ["--json"],
      envVars: [{ id: "env-1", name: "COMMUNITY_API_TOKEN", value: secret, enabled: true, sensitive: false }],
      settings: {},
    });
    expect(saved.envVars[0]).toMatchObject({ sensitive: true, value: CLI_SECRET_MASK });
    expect(JSON.stringify(saved)).not.toContain(secret);
    await expect(application.revealConnectionSecret(detail.id, { kind: "environment", key: "env-1" }))
      .resolves.toEqual({ value: secret });
    expect(JSON.stringify(await application.list())).not.toContain(secret);

    await application.disable(pluginId);
    const disabledConnection = await db.providerConnection.findUnique({ where: { id: detail.id } });
    expect(disabledConnection).toMatchObject({ enabled: false, testStatus: "unavailable" });
    await expect(application.enable(pluginId)).resolves.toMatchObject({ enabled: true });
    await application.disable(pluginId);
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
    await application.uninstall(pluginId);
    expect(await application.runtime.get(pluginId)).toBeNull();
    expect(await db.providerConnection.findUnique({ where: { id: detail.id } })).toMatchObject({
      provider: pluginId,
      enabled: false,
    });
    expect(await db.aiCapabilityTarget.findMany({ where: { capabilityConfigId: capability.id } }))
      .toHaveLength(1);

    const reinstall = await application.planLocal(source);
    await application.install(reinstall.planDigest);
    await application.confirmAndEnable(reinstall.planDigest);
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
