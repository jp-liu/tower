import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateLegacyTowerMcp } from "../migrate-legacy-mcp";

describe("migrateLegacyTowerMcp", () => {
  let homeDir: string;
  let repoRoot: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "tower-mig-home-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tower-mig-repo-"));
    fs.mkdirSync(path.join(homeDir, ".claude"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("is idempotent when no legacy entries exist", () => {
    const r = migrateLegacyTowerMcp({ homeDir, repoRoot });
    expect(r.removedAny).toBe(false);
    expect(r.steps).toHaveLength(2);
    expect(r.steps.every((s) => !s.removed)).toBe(true);
  });

  it("removes mcpServers.tower from ~/.claude/settings.json (wrong file)", () => {
    const settingsPath = path.join(homeDir, ".claude", "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: { Stop: [] },
        mcpServers: {
          tower: { command: "node", args: ["/some/path.cjs"] },
          other: { command: "npx", args: ["other-mcp"] },
        },
      }),
      "utf-8",
    );

    const r = migrateLegacyTowerMcp({ homeDir, repoRoot });
    expect(r.removedAny).toBe(true);
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(data.mcpServers.tower).toBeUndefined();
    expect(data.mcpServers.other).toBeDefined();
    expect(data.hooks).toBeDefined();
  });

  it("drops empty mcpServers key after removing the only tower entry", () => {
    const settingsPath = path.join(homeDir, ".claude", "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ mcpServers: { tower: { command: "x", args: [] } } }),
      "utf-8",
    );

    migrateLegacyTowerMcp({ homeDir, repoRoot });
    const data = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(data.mcpServers).toBeUndefined();
  });

  it("leaves ~/.mcp.json tower entry alone when it points into the current repo", () => {
    const repoMcp = path.join(repoRoot, "src", "mcp", "index.ts");
    fs.mkdirSync(path.dirname(repoMcp), { recursive: true });
    fs.writeFileSync(repoMcp, "// fake", "utf-8");

    const homeMcp = path.join(homeDir, ".mcp.json");
    fs.writeFileSync(
      homeMcp,
      JSON.stringify({
        mcpServers: {
          tower: { command: "tsx", args: [repoMcp] },
        },
      }),
      "utf-8",
    );

    const r = migrateLegacyTowerMcp({ homeDir, repoRoot });
    expect(r.removedAny).toBe(false);
    const data = JSON.parse(fs.readFileSync(homeMcp, "utf-8"));
    expect(data.mcpServers.tower).toBeDefined();
  });

  it("removes ~/.mcp.json tower entry that points outside the current repo", () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "other-repo-"));
    const otherEntry = path.join(otherDir, "index.ts");
    fs.writeFileSync(otherEntry, "// fake", "utf-8");

    try {
      const homeMcp = path.join(homeDir, ".mcp.json");
      fs.writeFileSync(
        homeMcp,
        JSON.stringify({
          mcpServers: {
            tower: { command: "tsx", args: [otherEntry] },
          },
        }),
        "utf-8",
      );

      const r = migrateLegacyTowerMcp({ homeDir, repoRoot });
      const towerStep = r.steps.find((s) => s.path === homeMcp);
      expect(towerStep?.removed).toBe(true);
      expect(towerStep?.reason).toBe("home-mcp-json:foreign-repo");
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("removes ~/.mcp.json tower entry whose target no longer exists", () => {
    const homeMcp = path.join(homeDir, ".mcp.json");
    fs.writeFileSync(
      homeMcp,
      JSON.stringify({
        mcpServers: {
          tower: { command: "node", args: ["/this/path/does/not/exist.cjs"] },
        },
      }),
      "utf-8",
    );

    const r = migrateLegacyTowerMcp({ homeDir, repoRoot });
    const step = r.steps.find((s) => s.path === homeMcp);
    expect(step?.removed).toBe(true);
    expect(step?.reason).toBe("home-mcp-json:missing-path");
  });
});
