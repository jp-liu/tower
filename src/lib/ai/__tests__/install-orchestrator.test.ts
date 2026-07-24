// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adapter } = vi.hoisted(() => ({
  adapter: {
    mcp: { install: vi.fn(), inspect: vi.fn() },
    hooks: { install: vi.fn(), inspect: vi.fn() },
    skills: { install: vi.fn(), inspect: vi.fn() },
  },
}));

vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: {
    get: vi.fn((name: string) => name === "codex" ? {
      cli: {
        adapter,
        plugin: { manifest: { capabilities: { integrations: { mcp: true, hooks: true, skills: true } } } },
      },
    } : undefined),
    createResolvedCliAdapter: vi.fn(async (name: string) =>
      name === "codex" ? { adapter, commandPath: "/usr/local/bin/codex" } : null),
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
  });

  it("declares every task-scoped Tower environment variable for MCP forwarding", () => {
    expect(buildTowerMcpConfig().envVars).toEqual([...TOWER_MCP_ENV_VARS]);
    expect(buildTowerMcpConfig().env).toEqual({
      DATABASE_URL: "file:/Users/test/.tower/database/tower.db",
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

    expect(adapter.mcp.install).toHaveBeenCalledOnce();
    expect(adapter.hooks.install).toHaveBeenCalledOnce();
    expect(adapter.skills.install).toHaveBeenCalledTimes(4);
    expect(report.hooks).toMatchObject({
      ok: false,
      error: "Hooks verification failed after install",
    });
    expect(report.ok).toBe(false);
  });

  it.each([
    ["MCP", "mcp"],
    ["Hooks", "hooks"],
    ["Skills", "skills"],
  ] as const)("normalizes a thrown %s install without rejecting the provider report", async (_label, integration) => {
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
