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
    expect(fs.existsSync(path.join(
      paths.openclawExtensionsDir,
      "tower-capability-bridge",
      "openclaw.plugin.json",
    ))).toBe(true);
    expect(fs.readFileSync(path.join(workspace, "gateway.env"), "utf-8")).toContain(
      'NO_PROXY="localhost,127.0.0.1,::1,.example.test"',
    );

    const cfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      agents: { list: Array<Record<string, unknown>> };
      plugins?: { allow?: string[]; entries?: Record<string, { enabled?: boolean }> };
    };
    const agent = cfg.agents.list.find((item) => item.id === "o-tower");
    expect(agent).toMatchObject({
      id: "o-tower",
      name: "o-tower",
      identity: { name: "小塔", emoji: "🗼" },
    });
    expect(agent?.model).toEqual({ primary: "keep/me" });
    expect(cfg.plugins?.allow).toBeUndefined();
    expect(cfg.plugins?.entries?.["tower-capability-bridge"]?.enabled).toBe(true);
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

  it("ships a mobile-safe Feishu card and media delivery contract", () => {
    const agentInstructions = fs.readFileSync(
      path.join(process.cwd(), "extensions", "tower-agent", "agent", "AGENTS.md"),
      "utf-8",
    );
    expect(agentInstructions).toContain("structured `presentation` titled with `小塔`");
    expect(agentInstructions).toContain("only `cache_ready`, never `published` or");
    expect(agentInstructions).toContain("whose `kind` is `image` or `media`");
    expect(agentInstructions).toContain("local path or file URL in the presentation");
    expect(agentInstructions).toContain("never use a `markdown` block");
    expect(agentInstructions).toContain("card without a verified visible body as failed delivery");
    expect(agentInstructions).toContain("do not ask the Operator to discover local files");
    expect(agentInstructions).toContain("Route by information ownership before routing by output format");
    expect(agentInstructions).toContain("does not turn project knowledge into external-operator work");
    expect(agentInstructions).toContain("no general `~/knowledge` route");

    const toolInstructions = fs.readFileSync(
      path.join(process.cwd(), "extensions", "tower-agent", "agent", "TOOLS.md"),
      "utf-8",
    );
    expect(toolInstructions).toContain("Use only `text`, `context`, and `divider` blocks");
    expect(toolInstructions).toContain("A `kind=card` receipt alone is therefore not");
    expect(toolInstructions).toContain("form the exact file URL");
    expect(toolInstructions).toContain("Project-content routing takes precedence over presentation routing");
    expect(toolInstructions).toContain("does not implement a general");
  });

  it("appends to an existing OpenClaw plugin allowlist without replacing it", async () => {
    const paths = testPaths();
    fs.mkdirSync(path.dirname(paths.openclawConfigPath), { recursive: true });
    fs.writeFileSync(paths.openclawConfigPath, JSON.stringify({
      plugins: {
        allow: ["existing-plugin"],
        entries: { "existing-plugin": { enabled: true } },
      },
    }), "utf-8");

    const result = await installTowerAgentExtension({ gateway: "openclaw", paths });

    expect(result.success).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      plugins: { allow: string[]; entries: Record<string, { enabled?: boolean }> };
    };
    expect(cfg.plugins.allow).toEqual(["existing-plugin", "tower-capability-bridge"]);
    expect(cfg.plugins.entries["existing-plugin"]).toEqual({ enabled: true });
    expect(cfg.plugins.entries["tower-capability-bridge"]?.enabled).toBe(true);
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
    expect(installed.version).toBe("9");

    const removed = await uninstallTowerAgentExtension("openclaw", { paths });
    expect(removed.success).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      agents?: { list?: Array<Record<string, unknown>> };
      bindings?: Array<Record<string, unknown>>;
      channels?: Record<string, Record<string, unknown>>;
      env?: { vars?: Record<string, string> };
      plugins?: { allow?: string[]; entries?: Record<string, unknown> };
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
    expect(fs.existsSync(path.join(paths.openclawExtensionsDir, "tower-capability-bridge"))).toBe(false);
    expect(cfg.plugins?.entries?.["tower-capability-bridge"]).toBeUndefined();
    expect(cfg.plugins?.allow ?? []).not.toContain("tower-capability-bridge");
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
        plugins: {
          entries: {
            "tower-capability-bridge": {
              config: {
                capabilities: [{ name: "computer.gui.act", agentId: "private-operator" }],
              },
            },
          },
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

    const mcpConfig = JSON.parse(
      fs.readFileSync(path.join(paths.openclawWorkspacesDir, "o-tower", "mcp.json"), "utf-8"),
    ) as { mcpServers: Record<string, { env: Record<string, string> }> };
    expect(Object.values(mcpConfig.mcpServers)[0]?.env.TOWER_MCP_PROFILE).toBe("gateway");

    const cfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      agents: { list: Array<Record<string, unknown>> };
      channels: Record<string, Record<string, unknown>>;
      bindings: Array<Record<string, unknown>>;
    };
    const agent = cfg.agents.list.find((item) => item.id === "o-tower");
    expect(agent?.model).toBe("keep/model");
    expect(agent?.subagents).toEqual({
      allowAgents: ["private-operator"],
      requireAgentId: true,
    });
    expect(agent?.tools).toMatchObject({
      profile: "minimal",
      elevated: { enabled: false },
      toolsBySender: {
        "channel:feishu:ou_owner": {
          allow: expect.arrayContaining([
            "tower_sender_role",
            "tower__route_gateway_message",
            "tower__resolve_gateway_task_context",
            "tower__continue_bound_task",
            "tower__reply_to_ask",
            "tower__list_tasks",
            "tower__recover_gateway_request",
            "tower__provision_remote_project",
            "agents_list",
            "sessions_send",
            "message",
            "session_status",
          ]),
        },
        "*": {
          allow: [
            "tower_sender_role",
            "tower__route_gateway_query",
          ],
        },
      },
    });
    expect(agent?.skills).toEqual(["tower"]);
    expect(agent?.tools).not.toMatchObject({
      alsoAllow: expect.arrayContaining(["tower__create_task"]),
    });
    const openClawMcpServers = Object.values(
      (cfg as { mcp?: { servers?: Record<string, { env?: Record<string, string> }> } }).mcp?.servers ?? {},
    );
    expect(openClawMcpServers).toContainEqual(expect.objectContaining({
      env: expect.objectContaining({ TOWER_MCP_PROFILE: "gateway" }),
    }));
    expect((cfg as { tools?: Record<string, unknown> }).tools).toMatchObject({
      alsoAllow: ["message"],
      agentToAgent: {
        enabled: true,
        allow: ["o-tower", "private-operator"],
      },
      sessions: { visibility: "all" },
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
      "message",
    ]));
    expect(cfg.channels.feishu).toMatchObject({
      dmPolicy: "allowlist",
      allowFrom: ["ou_owner"],
      groupPolicy: "open",
      groupSenderAllowFrom: ["*"],
      groups: {
        "*": {
          enabled: true,
          requireMention: true,
          systemPrompt: expect.stringContaining("sender_is_owner"),
        },
        oc_trusted: {
          enabled: true,
          requireMention: true,
          systemPrompt: expect.stringContaining("sender_is_owner"),
        },
      },
    });
    expect((cfg.channels.feishu.groups as Record<string, unknown>).oc_removed).toBeDefined();
    expect(cfg.bindings).toContainEqual({
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

    const ownerOnly = await installTowerAgentExtension({
      gateway: "openclaw",
      accessPolicy: { ownerIds: { feishu: ["ou_owner"] } },
      paths,
    });
    expect(ownerOnly.success).toBe(true);
    const ownerOnlyCfg = JSON.parse(fs.readFileSync(paths.openclawConfigPath, "utf-8")) as {
      channels: Record<string, Record<string, unknown>>;
      bindings: Array<Record<string, unknown>>;
    };
    expect(ownerOnlyCfg.channels.feishu).toMatchObject({
      dmPolicy: "allowlist",
      allowFrom: ["ou_owner"],
      groupPolicy: "open",
      groupSenderAllowFrom: ["*"],
      groups: {
        "*": {
          enabled: true,
          requireMention: true,
        },
      },
    });
    expect(ownerOnlyCfg.bindings).toContainEqual({
      type: "route",
      agentId: "o-tower",
      match: { channel: "feishu" },
    });
    expect(ownerOnlyCfg.bindings).not.toContainEqual({
      type: "route",
      agentId: "o-tower",
      match: { channel: "feishu", peer: { kind: "group", id: "oc_trusted" } },
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
    openclawExtensionsDir: path.join(root, ".openclaw", "extensions"),
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
  const pluginDir = path.join(base, "extensions", "tower-agent", "openclaw-capability");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "openclaw.plugin.json"), "{}\n", "utf-8");
  fs.writeFileSync(path.join(pluginDir, "index.js"), "export default {};\n", "utf-8");
}
