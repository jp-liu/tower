/**
 * Install orchestrator — runs MCP, hooks, and skill registration for a single
 * provider in one go. Called from /api/adapters/test on the success branch
 * (i.e. only after a hello probe passed).
 *
 * This used to live in init-tower.ts and ran on every server boot. The boot
 * path now does NOT touch user system files. See .notes/ai-provider-integration.md
 * for the rationale.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { CliAdapter, InstallResult, McpServerConfig } from "./types";
import { providerRegistry } from "./providers";
import { getTowerDbPath, getTowerDir } from "../tower-dir";
import { migrateLegacyTowerMcp, type MigrationReport } from "./migrate-legacy-mcp";
import { getPackageRoot } from "../tower-paths";

/**
 * Skill content is identical across dev/prod (same SKILL.md). Always use the
 * canonical names so a symlink per skill under ~/.claude/skills suffices.
 *   - tower       : task-management operator (bridge / assistant)
 *   - tower-goal  : run-time "unattended goal mode" for a working task terminal
 *   - tower-ask   : send-a-message-to-a-human primitive (used by tower-goal)
 */
const TOWER_SKILL_NAME = "tower";
const TOWER_SKILL_NAMES = ["tower", "tower-goal", "tower-ask"];

/**
 * MCP name MUST differ across data dirs so dev and prod can coexist in
 * the user's `claude mcp list`. Each entry carries its own DATABASE_URL,
 * so reusing the same name would mean later installs silently overwrite
 * earlier ones — and the user loses access to the other DB.
 *
 * Mapping:
 *   ~/.tower          → "tower"           (canonical / production)
 *   ~/.tower-dev      → "tower-dev"
 *   ~/.tower-staging  → "tower-staging"
 *   $TOWER_DATA_DIR=/some/custom/path → "tower-{basename(path)}"
 */
export function getTowerMcpName(): string {
  const towerDir = getTowerDir();
  const canonical = path.join(homedir(), ".tower");
  if (path.resolve(towerDir) === path.resolve(canonical)) return "tower";

  const base = path.basename(towerDir);
  // Common case: dir name is "<.>tower-<suffix>" — strip the prefix.
  const suffixMatch = base.match(/^\.?tower-(.+)$/);
  if (suffixMatch) return `tower-${sanitizeSuffix(suffixMatch[1])}`;

  // Custom dir name not following the convention — fall back to a sanitized
  // basename so we still produce a unique MCP key.
  return `tower-${sanitizeSuffix(base)}`;
}

function sanitizeSuffix(s: string): string {
  return s.replace(/[^a-z0-9_-]/gi, "-").toLowerCase().slice(0, 32);
}

export interface ProviderInstallReport {
  provider: string;
  /** Was the provider's CLI actually available? If not, nothing else ran. */
  available: boolean;
  migration?: MigrationReport;
  mcp?: InstallResult;
  hooks?: InstallResult;
  skill?: InstallResult;
  /** Convenience: true iff every attempted step succeeded. */
  ok: boolean;
}

/**
 * Build the spawn command for the Tower MCP server. The `name` field is
 * derived from the data dir (see getTowerMcpName) so dev and prod installs
 * land as distinct entries in the user's `claude mcp list`.
 */
export function buildTowerMcpConfig(): McpServerConfig {
  const root = getPackageRoot().replace(/\\/g, "/");
  const dbUrl =
    process.env.DATABASE_URL || `file:${getTowerDbPath().replace(/\\/g, "/")}`;
  // Pin TOWER_DATA_DIR alongside DATABASE_URL. The MCP process is spawned by the
  // user's CLI (claude/codex) and does NOT inherit Tower's runtime env, so
  // without this getTowerDir() would fall back to ~/.tower at MCP runtime —
  // mismatching the registering server's data dir (dev: ~/.tower-dev, or a
  // custom TOWER_DATA_DIR). That mismatch is what made create_task write assets
  // to the wrong storage root. Storage relocation stays dynamic: getStorageDir()
  // still reads the pointer file under this data dir at runtime, so a custom
  // Settings path keeps working without re-registering the MCP server.
  const env = { DATABASE_URL: dbUrl, TOWER_DATA_DIR: getTowerDir() };
  const builtPath = `${root}/dist/mcp-server.cjs`;
  const name = getTowerMcpName();

  if (existsSync(builtPath)) {
    return {
      name,
      command: "node",
      args: [builtPath],
      env,
    };
  }

  return {
    name,
    command: `${root}/node_modules/.bin/tsx`,
    args: [`${root}/src/mcp/index.ts`],
    env,
  };
}

/** Absolute path to a Tower skill's source dir inside this repo. */
export function getTowerSkillSourceDir(skillName: string = TOWER_SKILL_NAME): string {
  return path.join(getPackageRoot(), "skills", skillName);
}

/**
 * Install MCP, hooks, and skill for a single provider. Order matters:
 *   1. legacy migration (idempotent)
 *   2. MCP install via CLI (`claude mcp add-json` / `codex mcp add`)
 *   3. Hook install (file write — no CLI subcommand exists)
 *   4. Skill install (symlink)
 */
export async function installAllForProvider(
  providerName: string,
  apiUrl: string,
): Promise<ProviderInstallReport> {
  const provider = providerRegistry.get(providerName);
  const adapter: CliAdapter | undefined = provider?.cli?.adapter;
  if (!adapter) {
    return {
      provider: providerName,
      available: false,
      ok: false,
    };
  }

  const available = await adapter.isAvailable();
  if (!available) {
    return { provider: providerName, available: false, ok: false };
  }

  // Migrate first — this is a one-time cleanup of where older Tower wrote the
  // entry. Only Claude has a legacy entry; for other providers it's a no-op.
  const migration =
    providerName === "claude" ? migrateLegacyTowerMcp() : undefined;

  const mcpConfig = buildTowerMcpConfig();
  const mcp = await adapter.installMcp(mcpConfig, { scope: "user" });
  const hooks = await adapter.installHooks(apiUrl);
  // Install every Tower skill (tower + tower-goal + tower-ask). Report the first
  // failure if any, else the canonical `tower` result — ok reflects all of them.
  const skillResults = await Promise.all(
    TOWER_SKILL_NAMES.map((name) => adapter.installSkill(name, getTowerSkillSourceDir(name))),
  );
  const skill = skillResults.find((r) => !r.ok) ?? skillResults[0];

  return {
    provider: providerName,
    available: true,
    migration,
    mcp,
    hooks,
    skill,
    ok: mcp.ok && hooks.ok && skill.ok,
  };
}
