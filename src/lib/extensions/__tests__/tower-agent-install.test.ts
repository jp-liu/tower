// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkTowerAgentExtension,
  installTowerAgentExtension,
  uninstallTowerAgentExtension,
  type TowerAgentInstallPaths,
} from "../tower-agent-install";

let root: string;
let previousTowerDataDir: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tower-agent-install-"));
  previousTowerDataDir = process.env.TOWER_DATA_DIR;
  process.env.TOWER_DATA_DIR = path.join(root, ".tower");
  writeResourcePackage(root);
});

afterEach(() => {
  if (previousTowerDataDir === undefined) delete process.env.TOWER_DATA_DIR;
  else process.env.TOWER_DATA_DIR = previousTowerDataDir;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("tower agent extension installer", () => {
  it("installs an OpenClaw profile without writing model settings", async () => {
    const paths = testPaths();
    fs.mkdirSync(path.dirname(paths.openclawConfigPath), { recursive: true });
    fs.writeFileSync(
      paths.openclawConfigPath,
      JSON.stringify(
        {
          agents: {
            defaults: { model: { primary: "user/model" } },
            list: [{ id: "main" }, { id: "o-tower", model: { primary: "keep/me" } }],
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const result = await installTowerAgentExtension({
      gateway: "openclaw",
      profile: "o-tower",
      displayName: "小塔",
      env: {
        NO_PROXY: "localhost,127.0.0.1,::1,.example.test",
        HTTPS_PROXY: "http://127.0.0.1:7890",
      },
      paths,
    });

    expect(result.success).toBe(true);
    const workspace = path.join(paths.openclawWorkspacesDir, "o-tower");
    expect(fs.existsSync(path.join(workspace, "SOUL.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "skills", "tower", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "skills", "tower-ask", "SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(workspace, "skills", "tower-goal", "SKILL.md"))).toBe(false);
    // Default install stays Tower-only: no office/third-party (e.g. Feishu) skill is bundled.
    expect(fs.readdirSync(path.join(workspace, "skills")).sort()).toEqual(["tower"]);
    expect(fs.existsSync(path.join(workspace, "mcp.json"))).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "gateway.env"), "utf-8")).toContain(
      'NO_PROXY="localhost,127.0.0.1,::1,.example.test"',
    );

    const cfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      agents: { list: Array<Record<string, unknown>> };
    };
    const agent = cfg.agents.list.find((item) => item.id === "o-tower");
    expect(agent).toMatchObject({
      id: "o-tower",
      name: "o-tower",
      identity: { name: "小塔", emoji: "🗼" },
    });
    expect(agent?.model).toEqual({ primary: "keep/me" });
    expect(cfg).toMatchObject({
      env: {
        vars: {
          NO_PROXY: "localhost,127.0.0.1,::1,.example.test",
          HTTPS_PROXY: "http://127.0.0.1:7890",
        },
      },
    });

    const serviceEnv = fs.readFileSync(paths.openclawGatewayServiceEnvPath, "utf-8");
    expect(serviceEnv).toContain("export NO_PROXY='localhost,127.0.0.1,::1,.example.test'");
    expect(serviceEnv).toContain("export HTTPS_PROXY='http://127.0.0.1:7890'");

    const updated = await installTowerAgentExtension({
      gateway: "openclaw",
      profile: "o-tower",
      displayName: "塔塔",
      env: { NO_PROXY: "localhost" },
      paths,
    });
    expect(updated.success).toBe(true);
    const updatedCfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      env?: { vars?: Record<string, string> };
      agents: { list: Array<Record<string, unknown>> };
    };
    const updatedAgent = updatedCfg.agents.list.find((item) => item.id === "o-tower");
    expect(updatedAgent).toMatchObject({
      id: "o-tower",
      identity: { name: "塔塔", emoji: "🗼" },
    });
    expect(updatedAgent?.model).toEqual({ primary: "keep/me" });
    expect(updatedCfg.env?.vars).toMatchObject({ NO_PROXY: "localhost" });
    expect(updatedCfg.env?.vars?.HTTPS_PROXY).toBeUndefined();

    const updatedServiceEnv = fs.readFileSync(paths.openclawGatewayServiceEnvPath, "utf-8");
    expect(updatedServiceEnv).toContain("export NO_PROXY='localhost'");
    expect(updatedServiceEnv).not.toContain("HTTPS_PROXY");

    const marker = JSON.parse(fs.readFileSync(path.join(workspace, ".tower-agent.json"), "utf-8")) as { envKeys?: string[] };
    expect(marker.envKeys).toEqual(["NO_PROXY"]);
  });

  it("checks and uninstalls an OpenClaw profile using the Tower marker", async () => {
    const paths = testPaths();
    await installTowerAgentExtension({ gateway: "openclaw", paths });

    const installed = await checkTowerAgentExtension("openclaw", { paths });
    expect(installed.installed).toBe(true);
    expect(installed.version).toBe("2");

    const removed = await uninstallTowerAgentExtension("openclaw", { paths });
    expect(removed.success).toBe(true);

    const after = await checkTowerAgentExtension("openclaw", { paths });
    expect(after.installed).toBe(false);
  });
});

function testPaths(): TowerAgentInstallPaths {
  return {
    homeDir: root,
    packageRoot: root,
    openclawConfigPath: path.join(root, ".openclaw", "openclaw.json"),
    openclawWorkspacesDir: path.join(root, ".openclaw", "workspaces"),
    openclawAgentsDir: path.join(root, ".openclaw", "agents"),
    openclawGatewayServiceEnvPath: path.join(root, ".openclaw", "service-env", "ai.openclaw.gateway.env"),
    hermesProfilesDir: path.join(root, ".hermes", "profiles"),
  };
}

function writeResourcePackage(base: string): void {
  const agentDir = path.join(base, "extensions", "tower-agent", "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "SOUL.md"), "Tower soul\n", "utf-8");
  fs.writeFileSync(path.join(agentDir, "AGENTS.md"), "Tower agents\n", "utf-8");
  fs.writeFileSync(path.join(agentDir, "TOOLS.md"), "Tower tools\n", "utf-8");
}
