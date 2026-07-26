// @vitest-environment node
import type { CliAdapter, CliPluginManifestV1 } from "@tower-org/ai-sdk";
import { claudeManifest } from "@tower-org/ai-provider-claude";
import { codexManifest } from "@tower-org/ai-provider-codex";
import { geminiManifest } from "@tower-org/ai-provider-gemini";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adapter } = vi.hoisted(() => ({
  adapter: {
    mcp: { install: vi.fn(), inspect: vi.fn() },
    hooks: { install: vi.fn(), inspect: vi.fn() },
    skills: { install: vi.fn(), inspect: vi.fn() },
  },
}));

const providerDefinition = {
  name: "codex",
  displayName: "Codex",
  agentFieldValue: "CODEX",
  builtin: true,
  cli: {
    adapter,
    plugin: { manifest: {
      capabilities: { integrations: { mcp: true, hooks: true, skills: true } },
      permissions: ["integration:mcp", "integration:hooks", "integration:skills"],
    } },
  },
};

vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: {
    get: vi.fn((name: string) => name === "codex" ? providerDefinition : undefined),
    createResolvedCliAdapter: vi.fn(async (name: string) =>
      name === "codex" ? {
        adapter,
        provider: providerDefinition,
        manifest: providerDefinition.cli.plugin.manifest,
        providerVersion: "0.1.0",
        commandPath: "/usr/local/bin/codex",
        version: "codex 0.145.0",
        connectionId: "codex-connection",
        configurationDigest: "safe",
      }
        : name === "@acme/community-cli" ? {
          adapter,
          provider: { ...providerDefinition, name, displayName: "Community CLI", builtin: false },
          manifest: providerDefinition.cli.plugin.manifest,
          providerVersion: "1.2.3",
          commandPath: "/usr/local/bin/community-cli",
          version: "community 1.2.3",
          connectionId: "community-connection",
          configurationDigest: "safe",
        }
        : null),
  },
}));

vi.mock("@/lib/tower-dir", () => ({
  getTowerDbPath: vi.fn(() => "/Users/test/.tower/database/tower.db"),
  getTowerDir: vi.fn(() => "/Users/test/.tower"),
}));

vi.mock("@/lib/tower-paths", () => ({
  getPackageRoot: vi.fn(() => "/opt/tower"),
}));

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: vi.fn(() => "/Users/test"),
}));

vi.mock("@/lib/ai/migrate-legacy-mcp", () => ({
  migrateLegacyTowerMcp: vi.fn(),
}));

import {
  buildTowerMcpConfig,
  inspectProviderIntegration,
  installAllForProvider,
  reconcileResolvedProviderIntegrations,
  shouldRefreshProviderIntegration,
} from "@/lib/ai/install-orchestrator";
import { TOWER_MCP_ENV_VARS } from "@/lib/ai/tower-mcp-env";

describe("inspectProviderIntegration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapter.mcp.install.mockResolvedValue({ installed: true, changed: true, detail: "tower" });
    adapter.hooks.install.mockResolvedValue({ installed: true, changed: true, detail: "hooks.json" });
    adapter.skills.install.mockResolvedValue({ installed: true, changed: true, detail: "skill" });
    adapter.mcp.inspect.mockResolvedValue({ installed: true });
    adapter.hooks.inspect.mockResolvedValue({ installed: true });
    adapter.skills.inspect.mockResolvedValue({ installed: true });
    providerDefinition.cli.plugin.manifest.permissions = [
      "integration:mcp", "integration:hooks", "integration:skills",
    ];
  });

  it("declares every task-scoped Tower environment variable for MCP forwarding", () => {
    expect(buildTowerMcpConfig().envVars).toEqual([...TOWER_MCP_ENV_VARS]);
    expect(buildTowerMcpConfig().env).toEqual({
      DATABASE_URL: process.env.DATABASE_URL || "file:/Users/test/.tower/database/tower.db",
      TOWER_DATA_DIR: "/Users/test/.tower",
    });
  });

  it("checks the real MCP, hooks, and every Tower skill installation", async () => {
    const result = await inspectProviderIntegration("codex");

    expect(adapter.mcp.inspect).toHaveBeenCalledWith(expect.objectContaining({ name: "tower", scope: "user" }));
    expect(adapter.hooks.inspect).toHaveBeenCalledOnce();
    expect(adapter.skills.inspect).toHaveBeenCalledTimes(4);
    expect(adapter.skills.inspect).toHaveBeenCalledWith(expect.objectContaining({ name: "tower", sourceDir: "/opt/tower/skills/tower" }));
    expect(adapter.skills.inspect).toHaveBeenCalledWith(expect.objectContaining({ name: "tower-goal", sourceDir: "/opt/tower/skills/tower-goal" }));
    expect(adapter.skills.inspect).toHaveBeenCalledWith(expect.objectContaining({ name: "tower-ask", sourceDir: "/opt/tower/skills/tower-ask" }));
    expect(adapter.skills.inspect).toHaveBeenCalledWith(expect.objectContaining({ name: "tower-bridge", sourceDir: "/opt/tower/skills/tower-bridge" }));
    expect(result).toEqual({
      mcpInstalled: true,
      hooksInstalled: true,
      skillsInstalled: true,
      ok: true,
    });
  });

  it("reports incomplete state when the CLI was reinstalled without hooks", async () => {
    adapter.hooks.inspect.mockResolvedValue({ installed: false });

    await expect(inspectProviderIntegration("codex")).resolves.toEqual({
      mcpInstalled: true,
      hooksInstalled: false,
      skillsInstalled: true,
      ok: false,
    });
  });

  it("refreshes a current database record when the real Codex hooks disappeared", async () => {
    adapter.hooks.inspect.mockResolvedValue({ installed: false });
    const fingerprint = "schema=2|version=test";

    await expect(shouldRefreshProviderIntegration("codex", {
      testOk: true,
      mcpInstalled: true,
      hooksInstalled: true,
      skillsInstalled: true,
      installLog: JSON.stringify({ integrationFingerprint: fingerprint }),
    }, fingerprint)).resolves.toBe(true);
  });

  it("skips startup repair only when the record and real integration are current", async () => {
    const fingerprint = "schema=2|version=test";

    await expect(shouldRefreshProviderIntegration("codex", {
      testOk: true,
      mcpInstalled: true,
      hooksInstalled: true,
      skillsInstalled: true,
      installLog: JSON.stringify({ integrationFingerprint: fingerprint }),
    }, fingerprint)).resolves.toBe(false);
  });

  it("treats inspection errors as a missing integration", async () => {
    adapter.mcp.inspect.mockRejectedValue(new Error("codex config unavailable"));

    await expect(inspectProviderIntegration("codex")).resolves.toMatchObject({
      mcpInstalled: false,
      ok: false,
    });
  });

  it("verifies a refreshed integration before reporting install success", async () => {
    adapter.hooks.inspect.mockResolvedValue({ installed: false });

    const report = await installAllForProvider("codex", "http://localhost:3000");

    expect(adapter.mcp.install).not.toHaveBeenCalled();
    expect(adapter.hooks.install).toHaveBeenCalledOnce();
    expect(adapter.skills.install).not.toHaveBeenCalled();
    expect(report.hooks).toMatchObject({
      ok: false,
      error: "Hooks verification failed after install",
    });
    expect(report.ok).toBe(false);
  });

  it("installs integrations for a dynamically resolved provider without a static definition", async () => {
    adapter.mcp.inspect.mockResolvedValueOnce({ installed: false });
    adapter.hooks.inspect.mockResolvedValueOnce({ installed: false });
    for (let index = 0; index < 4; index += 1) {
      adapter.skills.inspect.mockResolvedValueOnce({ installed: false });
    }
    const report = await installAllForProvider("@acme/community-cli", "http://localhost:3000");

    expect(report).toMatchObject({ provider: "@acme/community-cli", available: true, ok: true });
    expect(adapter.mcp.install).toHaveBeenCalledOnce();
    expect(adapter.hooks.install).toHaveBeenCalledOnce();
    expect(adapter.skills.install).toHaveBeenCalledTimes(4);
  });

  it("does not retain third-party integration secrets in install reports", async () => {
    const canary = "CANARY_PLUGIN_INSTALL_SECRET_9f2c";
    adapter.mcp.inspect.mockResolvedValue({ installed: false });
    adapter.mcp.install.mockRejectedValue(new Error(canary));

    const report = await installAllForProvider("@acme/community-cli", "http://localhost:3000");

    expect(report.mcp).toMatchObject({ ok: false, error: "MCP install failed" });
    expect(JSON.stringify(report)).not.toContain(canary);
  });

  it("does not invoke third-party integration adapters without corresponding permissions", async () => {
    providerDefinition.cli.plugin.manifest.permissions = ["process:spawn"];

    const report = await installAllForProvider("@acme/community-cli", "http://localhost:3000");

    expect(report).toMatchObject({
      available: true,
      ok: true,
      desired: { mcp: false, hooks: false, skills: false },
    });
    expect(adapter.mcp.install).not.toHaveBeenCalled();
    expect(adapter.hooks.install).not.toHaveBeenCalled();
    expect(adapter.skills.install).not.toHaveBeenCalled();
  });

  it.each([
    ["MCP", "mcp"],
    ["Hooks", "hooks"],
    ["Skills", "skills"],
  ] as const)("normalizes a thrown %s install without rejecting the provider report", async (_label, integration) => {
    adapter[integration].inspect.mockResolvedValue({ installed: false });
    adapter[integration].install.mockRejectedValue(new Error(`${integration} unavailable`));

    const report = await installAllForProvider("codex", "http://localhost:3000");

    const result = integration === "skills" ? report.skill : report[integration];
    expect(result).toMatchObject({
      ok: false,
      error: `${integration} unavailable`,
    });
    expect(report.available).toBe(true);
    expect(report.ok).toBe(false);
  });
});

function statefulIntegrationAdapter(initial: {
  mcp: boolean;
  hooks: boolean;
  skills: Record<string, boolean>;
}) {
  const state = {
    mcp: initial.mcp,
    hooks: initial.hooks,
    skills: { ...initial.skills },
  };
  const installs = {
    mcp: vi.fn(async () => {
      state.mcp = true;
      return { installed: true, changed: true };
    }),
    hooks: vi.fn(async () => {
      state.hooks = true;
      return { installed: true, changed: true };
    }),
    skills: vi.fn(async ({ name }: { name: string }) => {
      state.skills[name] = true;
      return { installed: true, changed: true };
    }),
  };
  const adapter = {
    mcp: {
      inspect: vi.fn(async () => ({ installed: state.mcp })),
      install: installs.mcp,
    },
    hooks: {
      inspect: vi.fn(async () => ({ installed: state.hooks })),
      install: installs.hooks,
    },
    skills: {
      inspect: vi.fn(async ({ name }: { name: string }) => ({ installed: state.skills[name] === true })),
      install: installs.skills,
    },
  } as unknown as CliAdapter;
  return { adapter, state, installs };
}

describe("built-in provider reconciliation", () => {
  it.each([
    ["claude", claudeManifest, "mcp"],
    ["codex", codexManifest, "hooks"],
    ["gemini", geminiManifest, "skills"],
  ] as const)("repairs only removed %s integration state after its CLI path and version change", async (
    provider,
    manifest,
    removed,
  ) => {
    const fake = statefulIntegrationAdapter({
      mcp: true,
      hooks: manifest.capabilities.integrations?.hooks === true,
      skills: { tower: true, "tower-goal": true, "tower-ask": true, "tower-bridge": true },
    });
    const resolved = (commandPath: string, version: string) => ({
      adapter: fake.adapter,
      provider: {
        name: provider,
        displayName: provider,
        version: "0.1.0",
        agentFieldValue: provider.toUpperCase(),
        builtin: true,
        models: { cli: [], api: [] },
      },
      manifest: manifest as CliPluginManifestV1,
      providerVersion: "0.1.0",
      commandPath,
      version,
      connectionId: `${provider}-connection`,
      configurationDigest: "sha256:safe-configuration",
      dependency: {
        state: "ready" as const,
        dependency: `${provider} CLI`,
        commandPath,
        detectedVersion: version,
        supportedVersions: manifest.cliDependency.supportedVersions,
        homepage: manifest.cliDependency.homepage,
        installDocs: manifest.cliDependency.installDocs,
        managedByTower: false as const,
      },
    });
    const before = await reconcileResolvedProviderIntegrations(
      resolved(`/opt/old/${provider}`, "1.0.0"),
      "http://localhost:3000",
    );

    if (removed === "mcp") fake.state.mcp = false;
    if (removed === "hooks") fake.state.hooks = false;
    if (removed === "skills") fake.state.skills["tower-goal"] = false;
    const after = await reconcileResolvedProviderIntegrations(
      resolved(`/opt/new/${provider}`, "2.0.0"),
      "http://localhost:3000",
    );

    expect(before.ok).toBe(true);
    expect(after.ok).toBe(true);
    expect(after.integrationFingerprint).not.toBe(before.integrationFingerprint);
    expect(fake.installs.mcp).toHaveBeenCalledTimes(removed === "mcp" ? 1 : 0);
    expect(fake.installs.hooks).toHaveBeenCalledTimes(removed === "hooks" ? 1 : 0);
    expect(fake.installs.skills).toHaveBeenCalledTimes(removed === "skills" ? 1 : 0);
    if (removed === "skills") {
      expect(fake.installs.skills).toHaveBeenCalledWith(expect.objectContaining({ name: "tower-goal" }));
    }
  });
});
