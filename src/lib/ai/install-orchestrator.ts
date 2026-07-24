/**
 * Install orchestrator — runs MCP, hooks, and skill registration for a single
 * provider in one go. Called after a successful /api/adapters/test probe and
 * from the startup self-heal path when the recorded fingerprint or integration
 * state is stale.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { CliAdapter as SdkCliAdapter, CliIntegrationResult } from "@tower/ai-sdk";
import type { InstallResult, McpServerConfig } from "./types";
import { providerRegistry } from "./providers";
import { getTowerDbPath, getTowerDir } from "../tower-dir";
import { migrateLegacyTowerMcp, type MigrationReport } from "./migrate-legacy-mcp";
import { getPackageRoot } from "../tower-paths";
import { HermesCliAdapter } from "./adapters/cli/hermes-cli-adapter";
import { TOWER_MCP_ENV_VARS } from "./tower-mcp-env";
import packageJson from "../../../package.json";

/**
 * Skill content is identical across dev/prod (same SKILL.md). Always use the
 * canonical names so a symlink per skill under ~/.claude/skills suffices.
 *   - tower       : task-management operator (bridge / assistant)
 *   - tower-goal  : run-time "unattended goal mode" for a working task terminal
 *   - tower-ask   : send-a-message-to-a-human primitive (used by tower-goal)
 *   - tower-bridge: route content to a gateway, sibling task, or operator agent
 */
const TOWER_SKILL_NAME = "tower";
const TOWER_SKILL_NAMES = ["tower", "tower-goal", "tower-ask", "tower-bridge"];
const TOWER_GATEWAY_SKILL_NAMES = ["tower"];
const TOWER_INTEGRATION_SCHEMA_VERSION = 3;

export function buildTowerIntegrationFingerprint(apiUrl: string): string {
  return [
    `schema=${TOWER_INTEGRATION_SCHEMA_VERSION}`,
    `version=${packageJson.version}`,
    `root=${getPackageRoot()}`,
    `data=${getTowerDir()}`,
    `api=${apiUrl}`,
  ].join("|");
}

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
  /** Startup skips reinstall when this matches the current Tower runtime. */
  integrationFingerprint?: string;
  migration?: MigrationReport;
  mcp?: InstallResult;
  hooks?: InstallResult;
  skill?: InstallResult;
  /** Convenience: true iff every attempted step succeeded. */
  ok: boolean;
}

export interface ProviderIntegrationStatus {
  mcpInstalled: boolean;
  hooksInstalled: boolean;
  skillsInstalled: boolean;
  ok: boolean;
}

function asInstallResult(
  method: InstallResult["method"],
  result: CliIntegrationResult,
): InstallResult {
  return { ok: true, method, detail: result.detail ?? (result.changed ? "updated" : "already current") };
}

function unsupportedIntegration(name: string): InstallResult {
  return {
    ok: false,
    method: "cli",
    detail: `${name} unsupported`,
    error: `Provider manifest declares ${name} unsupported`,
  };
}

interface RecordedProviderIntegration {
  testOk: boolean;
  mcpInstalled: boolean;
  hooksInstalled: boolean;
  skillsInstalled: boolean;
  installLog: string | null;
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
      envVars: [...TOWER_MCP_ENV_VARS],
    };
  }

  return {
    name,
    command: `${root}/node_modules/.bin/tsx`,
    args: [`${root}/src/mcp/index.ts`],
    env,
    envVars: [...TOWER_MCP_ENV_VARS],
  };
}

/** Absolute path to a Tower skill's source dir inside this repo. */
export function getTowerSkillSourceDir(skillName: string = TOWER_SKILL_NAME): string {
  return path.join(getPackageRoot(), "skills", skillName);
}

/**
 * Inspect the provider's real user-scope integration state. The database is a
 * cache, not a source of truth: reinstalling a CLI can remove its config while
 * leaving ProviderConnection and the Tower package fingerprint unchanged.
 */
export async function inspectProviderIntegration(
  providerName: string,
): Promise<ProviderIntegrationStatus> {
  const resolved = await providerRegistry
    .createResolvedCliAdapter(providerName, getPackageRoot())
    .catch(() => null);
  const adapter = resolved?.adapter;
  if (!adapter) {
    return { mcpInstalled: false, hooksInstalled: false, skillsInstalled: false, ok: false };
  }

  const check = async (fn: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await fn();
    } catch {
      return false;
    }
  };

  const mcpConfig = buildTowerMcpConfig();
  const [mcpInstalled, hooksInstalled, skillChecks] = await Promise.all([
    check(async () => (await adapter.mcp?.inspect({ ...mcpConfig, scope: "user" }))?.installed ?? false),
    check(async () => (await adapter.hooks?.inspect({}))?.installed ?? false),
    Promise.all(
      TOWER_SKILL_NAMES.map((name) =>
        check(async () => (await adapter.skills?.inspect({
          name,
          sourceDir: getTowerSkillSourceDir(name),
          scope: "user",
        }))?.installed ?? false),
      ),
    ),
  ]);
  const skillsInstalled = skillChecks.every(Boolean);
  const integrations = providerRegistry.get(providerName)?.cli?.plugin.manifest.capabilities.integrations;

  return {
    mcpInstalled,
    hooksInstalled,
    skillsInstalled,
    ok: (!integrations?.mcp || mcpInstalled)
      && (!integrations?.hooks || hooksInstalled)
      && (!integrations?.skills || skillsInstalled),
  };
}

/**
 * Decide whether startup must repair a provider integration. A matching
 * database fingerprint is only a cache hit: Codex/Claude may have been
 * reinstalled since Tower last ran, deleting their user-scope integration.
 */
export async function shouldRefreshProviderIntegration(
  providerName: string,
  connection: RecordedProviderIntegration | null,
  integrationFingerprint: string,
): Promise<boolean> {
  if (!isRecordedIntegrationCurrent(providerName, connection, integrationFingerprint)) return true;
  return !(await inspectProviderIntegration(providerName)).ok;
}

function isRecordedIntegrationCurrent(
  providerName: string,
  connection: RecordedProviderIntegration | null,
  integrationFingerprint: string,
): boolean {
  if (!connection?.testOk) return false;
  const integrations = providerRegistry.get(providerName)?.cli?.plugin.manifest.capabilities.integrations;
  if ((integrations?.mcp && !connection.mcpInstalled)
    || (integrations?.hooks && !connection.hooksInstalled)
    || (integrations?.skills && !connection.skillsInstalled)) {
    return false;
  }
  if (!connection.installLog) return false;

  try {
    const report = JSON.parse(connection.installLog) as { integrationFingerprint?: unknown };
    return report.integrationFingerprint === integrationFingerprint;
  } catch {
    return false;
  }
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
  const integrationFingerprint = buildTowerIntegrationFingerprint(apiUrl);
  const provider = providerRegistry.get(providerName);
  if (!provider?.cli) {
    return {
      provider: providerName,
      available: false,
      integrationFingerprint,
      ok: false,
    };
  }

  const resolved = await providerRegistry.createResolvedCliAdapter(providerName, getPackageRoot()).catch(() => null);
  if (!resolved) {
    return { provider: providerName, available: false, integrationFingerprint, ok: false };
  }
  const adapter: SdkCliAdapter = resolved.adapter;

  // Migrate first — this is a one-time cleanup of where older Tower wrote the
  // entry. Only Claude has a legacy entry; for other providers it's a no-op.
  const migration =
    providerName === "claude" ? migrateLegacyTowerMcp() : undefined;

  const mcpConfig = buildTowerMcpConfig();
  const capabilities = provider.cli.plugin.manifest.capabilities.integrations;
  const mcp = adapter.mcp
    ? asInstallResult("cli", await adapter.mcp.install({ ...mcpConfig, scope: "user" }))
    : unsupportedIntegration("MCP");
  const hooks = adapter.hooks
    ? asInstallResult("file", await adapter.hooks.install({ apiUrl }))
    : unsupportedIntegration("Hooks");
  // Install every task-terminal Tower skill. Report the first failure if any,
  // else the canonical `tower` result — ok reflects all of them.
  const skillResults = await Promise.all(
    TOWER_SKILL_NAMES.map(async (name) => adapter.skills
      ? asInstallResult("symlink", await adapter.skills.install({
          name,
          sourceDir: getTowerSkillSourceDir(name),
          scope: "user",
        }))
      : unsupportedIntegration("Skills")),
  );
  const skill = skillResults.find((r) => !r.ok) ?? skillResults[0];
  const report: ProviderInstallReport = {
    provider: providerName,
    available: true,
    integrationFingerprint,
    migration,
    mcp,
    hooks,
    skill,
    ok: (!capabilities?.mcp || mcp.ok)
      && (!capabilities?.hooks || hooks.ok)
      && (!capabilities?.skills || skill.ok),
  };
  const actual = await inspectProviderIntegration(providerName);
  return applyIntegrationVerification(report, actual);
}

function applyIntegrationVerification(
  report: ProviderInstallReport,
  actual: ProviderIntegrationStatus,
): ProviderInstallReport {
  const verify = (
    result: InstallResult | undefined,
    installed: boolean,
    label: string,
  ): InstallResult | undefined => {
    if (!result || !result.ok || installed) return result;
    return { ...result, ok: false, error: `${label} verification failed after install` };
  };
  const mcp = verify(report.mcp, actual.mcpInstalled, "MCP");
  const hooks = verify(report.hooks, actual.hooksInstalled, "Hooks");
  const skill = verify(report.skill, actual.skillsInstalled, "Skills");
  const capabilities = providerRegistry.get(report.provider)?.cli?.plugin.manifest.capabilities.integrations;

  return {
    ...report,
    mcp,
    hooks,
    skill,
    ok: Boolean(actual.ok
      && (!capabilities?.mcp || mcp?.ok)
      && (!capabilities?.hooks || hooks?.ok)
      && (!capabilities?.skills || skill?.ok)),
  };
}

export async function installHermesGateway(profile?: string): Promise<ProviderInstallReport> {
  const provider = "hermes";
  const integrationFingerprint = buildTowerIntegrationFingerprint("");
  const adapter = new HermesCliAdapter(profile);
  const available = await adapter.isAvailable();
  if (!available) return { provider, available: false, integrationFingerprint, ok: false };

  const mcpConfig = buildTowerMcpConfig();
  const mcp = await adapter.installMcp(mcpConfig, { scope: "user" });
  const hooks = await adapter.installHooks("");
  const skillResults = await Promise.all(
    TOWER_GATEWAY_SKILL_NAMES.map((name) => adapter.installSkill(name, getTowerSkillSourceDir(name))),
  );
  const skill = skillResults.find((r) => !r.ok) ?? skillResults[0];

  return {
    provider,
    available: true,
    integrationFingerprint,
    mcp,
    hooks,
    skill,
    ok: mcp.ok && hooks.ok && skill.ok,
  };
}
