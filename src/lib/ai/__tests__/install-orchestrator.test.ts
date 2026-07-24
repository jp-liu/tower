// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { adapter } = vi.hoisted(() => ({
  adapter: {
    isAvailable: vi.fn(),
    installMcp: vi.fn(),
    installHooks: vi.fn(),
    installSkill: vi.fn(),
    isMcpInstalled: vi.fn(),
    isHooksInstalled: vi.fn(),
    isSkillInstalled: vi.fn(),
  },
}));

vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: {
    get: vi.fn((name: string) => name === "codex" ? { cli: { adapter } } : undefined),
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
} from "@/lib/ai/install-orchestrator";
import { TOWER_MCP_ENV_VARS } from "@/lib/ai/tower-mcp-env";

describe("inspectProviderIntegration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapter.isAvailable.mockResolvedValue(true);
    adapter.installMcp.mockResolvedValue({ ok: true, method: "cli", detail: "tower" });
    adapter.installHooks.mockResolvedValue({ ok: true, method: "file", detail: "hooks.json" });
    adapter.installSkill.mockResolvedValue({ ok: true, method: "symlink", detail: "skill" });
    adapter.isMcpInstalled.mockResolvedValue(true);
    adapter.isHooksInstalled.mockResolvedValue(true);
    adapter.isSkillInstalled.mockResolvedValue(true);
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

    expect(adapter.isMcpInstalled).toHaveBeenCalledWith("tower", { scope: "user" });
    expect(adapter.isHooksInstalled).toHaveBeenCalledOnce();
    expect(adapter.isSkillInstalled).toHaveBeenCalledTimes(4);
    expect(adapter.isSkillInstalled).toHaveBeenCalledWith("tower", "/opt/tower/skills/tower");
    expect(adapter.isSkillInstalled).toHaveBeenCalledWith("tower-goal", "/opt/tower/skills/tower-goal");
    expect(adapter.isSkillInstalled).toHaveBeenCalledWith("tower-ask", "/opt/tower/skills/tower-ask");
    expect(adapter.isSkillInstalled).toHaveBeenCalledWith("tower-bridge", "/opt/tower/skills/tower-bridge");
    expect(result).toEqual({
      mcpInstalled: true,
      hooksInstalled: true,
      skillsInstalled: true,
      ok: true,
    });
  });

  it("reports incomplete state when the CLI was reinstalled without hooks", async () => {
    adapter.isHooksInstalled.mockResolvedValue(false);

    await expect(inspectProviderIntegration("codex")).resolves.toEqual({
      mcpInstalled: true,
      hooksInstalled: false,
      skillsInstalled: true,
      ok: false,
    });
  });

  it("treats inspection errors as a missing integration", async () => {
    adapter.isMcpInstalled.mockRejectedValue(new Error("codex config unavailable"));

    await expect(inspectProviderIntegration("codex")).resolves.toMatchObject({
      mcpInstalled: false,
      ok: false,
    });
  });

  it("verifies a refreshed integration before reporting install success", async () => {
    adapter.isHooksInstalled.mockResolvedValue(false);

    const report = await installAllForProvider("codex", "http://localhost:3000");

    expect(adapter.installMcp).toHaveBeenCalledOnce();
    expect(adapter.installHooks).toHaveBeenCalledOnce();
    expect(adapter.installSkill).toHaveBeenCalledTimes(4);
    expect(report.hooks).toMatchObject({
      ok: false,
      error: "Hooks verification failed after install",
    });
    expect(report.ok).toBe(false);
  });
});
