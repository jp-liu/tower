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
    await installTowerAgentExtension({
      gateway: "openclaw",
      env: { HTTPS_PROXY: "http://127.0.0.1:7890" },
      accessPolicy: {
        ownerIds: { feishu: ["ou_owner"] },
        trustedChannels: { feishu: ["oc_trusted"] },
      },
      paths,
    });

    const installed = await checkTowerAgentExtension("openclaw", { paths });
    expect(installed.installed).toBe(true);
    expect(installed.version).toBe("3");

    const removed = await uninstallTowerAgentExtension("openclaw", { paths });
    expect(removed.success).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      agents?: { list?: Array<Record<string, unknown>> };
      bindings?: Array<Record<string, unknown>>;
      channels?: Record<string, Record<string, unknown>>;
      env?: { vars?: Record<string, string> };
    };
    expect(cfg.agents?.list?.some((item) => item.id === "o-tower")).toBe(false);
    expect(cfg.bindings?.some((item) => item.agentId === "o-tower")).toBe(false);
    expect(cfg.channels?.feishu).toMatchObject({
      dmPolicy: "disabled",
      allowFrom: [],
      groupPolicy: "disabled",
      groups: {},
    });
    expect(cfg.env?.vars?.HTTPS_PROXY).toBeUndefined();
    expect(fs.existsSync(path.join(paths.openclawAgentsDir, "o-tower"))).toBe(false);
    expect(fs.readFileSync(paths.openclawGatewayServiceEnvPath, "utf-8")).not.toContain("HTTPS_PROXY");

    const after = await checkTowerAgentExtension("openclaw", { paths });
    expect(after.installed).toBe(false);
  });

  it("installs owner and trusted-channel OpenClaw enforcement without relying on prompts", async () => {
    const paths = testPaths();
    fs.mkdirSync(path.dirname(paths.openclawConfigPath), { recursive: true });
    fs.writeFileSync(
      paths.openclawConfigPath,
      JSON.stringify({
        channels: {
          feishu: {
            enabled: true,
            groupPolicy: "open",
            dmPolicy: "open",
            groups: {
              oc_trusted: { systemPrompt: "preserve me" },
              oc_removed: { enabled: true, requireMention: false },
            },
          },
        },
        agents: {
          list: [{ id: "o-tower", model: "keep/model" }],
        },
        bindings: [
          { type: "route", agentId: "o-tower", match: { channel: "feishu" } },
          {
            type: "route",
            agentId: "o-tower",
            match: { channel: "feishu", peer: { kind: "group", id: "oc_removed" } },
          },
          { type: "route", agentId: "other", match: { channel: "feishu" } },
        ],
      }),
      "utf-8",
    );

    const result = await installTowerAgentExtension({
      gateway: "openclaw",
      accessPolicy: {
        ownerIds: { feishu: ["ou_owner"] },
        trustedChannels: { feishu: ["oc_trusted"] },
      },
      paths,
    });
    expect(result.success).toBe(true);

    const cfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      agents: { list: Array<Record<string, unknown>> };
      channels: Record<string, Record<string, unknown>>;
      bindings: Array<Record<string, unknown>>;
    };
    const agent = cfg.agents.list.find((item) => item.id === "o-tower");
    expect(agent?.model).toBe("keep/model");
    expect(agent?.tools).toMatchObject({
      profile: "minimal",
      elevated: { enabled: false },
      toolsBySender: {
        "channel:feishu:ou_owner": {
          allow: expect.arrayContaining([
            "tower__route_gateway_message",
            "tower__list_tasks",
            "tower__complete_gateway_discussion",
            "tower__recover_gateway_request",
            "tower__provision_remote_project",
            "session_status",
          ]),
        },
        "*": {
          allow: [
            "tower__route_gateway_query",
            "tower__read_gateway_project_context",
            "tower__complete_gateway_discussion",
          ],
        },
      },
    });
    expect(agent?.tools).not.toMatchObject({
      alsoAllow: expect.arrayContaining(["tower__create_task"]),
    });
    expect(
      (agent?.tools as { toolsBySender?: Record<string, { allow?: string[] }> })
        .toolsBySender?.["channel:feishu:ou_owner"]?.allow,
    ).not.toContain("tower__create_task");
    expect(
      (agent?.tools as { toolsBySender?: Record<string, { allow?: string[] }> })
        .toolsBySender?.["*"]?.allow,
    ).not.toEqual(expect.arrayContaining([
      "tower__recover_gateway_request",
      "tower__provision_remote_project",
    ]));
    expect(cfg.channels.feishu).toMatchObject({
      dmPolicy: "allowlist",
      allowFrom: ["ou_owner"],
      groupPolicy: "allowlist",
      groupSenderAllowFrom: ["*"],
      groups: {
        oc_trusted: {
          enabled: true,
          requireMention: true,
          systemPrompt: expect.stringContaining("verified sender"),
        },
      },
    });
    expect((cfg.channels.feishu.groups as Record<string, unknown>).oc_removed).toBeUndefined();
    expect(cfg.bindings).toContainEqual({
      type: "route",
      agentId: "o-tower",
      match: { channel: "feishu", peer: { kind: "direct", id: "ou_owner" } },
    });
    expect(cfg.bindings).toContainEqual({
      type: "route",
      agentId: "o-tower",
      match: { channel: "feishu", peer: { kind: "group", id: "oc_trusted" } },
    });
    expect(cfg.bindings).not.toContainEqual({
      type: "route",
      agentId: "o-tower",
      match: { channel: "feishu" },
    });
    expect(cfg.bindings).not.toContainEqual({
      type: "route",
      agentId: "o-tower",
      match: { channel: "feishu", peer: { kind: "group", id: "oc_removed" } },
    });
    expect(cfg.bindings).toContainEqual({
      type: "route",
      agentId: "other",
      match: { channel: "feishu" },
    });

    const revoked = await installTowerAgentExtension({
      gateway: "openclaw",
      accessPolicy: {},
      paths,
    });
    expect(revoked.success).toBe(true);
    const revokedCfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      agents: { list: Array<Record<string, unknown>> };
      channels: Record<string, Record<string, unknown>>;
      bindings: Array<Record<string, unknown>>;
    };
    expect(revokedCfg.agents.list.find((item) => item.id === "o-tower")?.tools).toEqual({
      profile: "minimal",
      alsoAllow: [],
      toolsBySender: { "*": { allow: [] } },
      elevated: { enabled: false },
    });
    expect(revokedCfg.channels.feishu).toMatchObject({
      dmPolicy: "disabled",
      allowFrom: [],
      groupPolicy: "disabled",
      groupSenderAllowFrom: [],
      groups: {},
    });
    expect(revokedCfg.bindings.some((item) => item.agentId === "o-tower")).toBe(false);
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
