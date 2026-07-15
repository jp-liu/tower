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
      paths,
    });

    expect(result.success).toBe(true);
    const workspace = path.join(paths.openclawWorkspacesDir, "o-tower");
    expect(fs.existsSync(path.join(workspace, "SOUL.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "skills", "tower", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "skills", "tower-ask", "SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(workspace, "skills", "tower-goal", "SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(workspace, "mcp.json"))).toBe(true);

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
  });

  it("checks and uninstalls an OpenClaw profile using the Tower marker", async () => {
    const paths = testPaths();
    await installTowerAgentExtension({ gateway: "openclaw", paths });

    const installed = await checkTowerAgentExtension("openclaw", { paths });
    expect(installed.installed).toBe(true);
    expect(installed.version).toBe("1");

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
