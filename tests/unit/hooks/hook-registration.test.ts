import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let root: string;
let dataDir: string;
let homeDir: string;

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

describe("Tower-owned assistant bootstrap", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "tower-bootstrap-test-"));
    dataDir = join(root, "data");
    homeDir = join(root, "home");
    mkdirSync(homeDir, { recursive: true });
    vi.stubEnv("HOME", homeDir);
    vi.stubEnv("TOWER_DATA_DIR", dataDir);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("initializes only the Tower-owned assistant directory", async () => {
    const { ensureTowerDir } = await import("@/lib/init-tower");

    expect(ensureTowerDir()).toBe(join(dataDir, "assistant"));
    expect(existsSync(join(dataDir, "assistant", "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(dataDir, "assistant", ".claude", "skills", "tower", "SKILL.md"))).toBe(true);
    expect(existsSync(join(homeDir, ".claude", "settings.json"))).toBe(false);
  });

  it("removes only the obsolete assistant MCP field and is idempotent", async () => {
    const { ensureTowerDir } = await import("@/lib/init-tower");
    const settingsFile = join(dataDir, "assistant", ".claude", "settings.json");
    mkdirSync(join(dataDir, "assistant", ".claude"), { recursive: true });
    writeFileSync(settingsFile, JSON.stringify({ theme: "dark", mcpServers: { tower: {} } }));

    ensureTowerDir();
    ensureTowerDir();

    expect(readJson(settingsFile)).toEqual({ theme: "dark" });
    expect(existsSync(join(homeDir, ".claude", "settings.json"))).toBe(false);
  });
});
