import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPackageRoot } from "@/lib/tower-paths";
import { buildTowerMcpConfig, getTowerSkillSourceDir, installHermesGateway } from "@/lib/ai/install-orchestrator";
import type { ExtensionResult, ExtensionStatus } from "./types";

export type TowerAgentGateway = "openclaw" | "hermes";

const TOWER_AGENT_PACKAGE_VERSION = "2";
const TOWER_GATEWAY_SKILL_NAMES = ["tower"] as const;

export interface TowerAgentInstallOptions {
  gateway: TowerAgentGateway;
  profile?: string;
  displayName?: string;
  env?: Record<string, string>;
  paths?: Partial<TowerAgentInstallPaths>;
}

export interface TowerAgentInstallPaths {
  homeDir: string;
  packageRoot: string;
  openclawConfigPath: string;
  openclawWorkspacesDir: string;
  openclawAgentsDir: string;
  openclawGatewayServiceEnvPath: string;
  hermesProfilesDir: string;
}

interface OpenClawConfig {
  agents?: {
    list?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface TowerAgentMarker {
  envKeys?: string[];
}

export function defaultTowerAgentProfile(gateway: TowerAgentGateway): string {
  return gateway === "openclaw" ? "o-tower" : "h-tower";
}

export function defaultTowerAgentDisplayName(): string {
  return "小塔";
}

export function getTowerAgentResourceDir(packageRoot = getPackageRoot()): string {
  return path.join(packageRoot, "extensions", "tower-agent");
}

function getPaths(overrides: Partial<TowerAgentInstallPaths> = {}): TowerAgentInstallPaths {
  const homeDir = overrides.homeDir ?? os.homedir();
  return {
    homeDir,
    packageRoot: overrides.packageRoot ?? getPackageRoot(),
    openclawConfigPath: overrides.openclawConfigPath ?? path.join(homeDir, ".openclaw", "openclaw.json"),
    openclawWorkspacesDir: overrides.openclawWorkspacesDir ?? path.join(homeDir, ".openclaw", "workspaces"),
    openclawAgentsDir: overrides.openclawAgentsDir ?? path.join(homeDir, ".openclaw", "agents"),
    openclawGatewayServiceEnvPath:
      overrides.openclawGatewayServiceEnvPath ?? path.join(homeDir, ".openclaw", "service-env", "ai.openclaw.gateway.env"),
    hermesProfilesDir: overrides.hermesProfilesDir ?? path.join(homeDir, ".hermes", "profiles"),
  };
}

export async function checkTowerAgentExtension(
  gateway: TowerAgentGateway,
  options: { profile?: string; paths?: Partial<TowerAgentInstallPaths> } = {},
): Promise<ExtensionStatus> {
  const profile = options.profile || defaultTowerAgentProfile(gateway);
  const paths = getPaths(options.paths);
  if (gateway === "openclaw") {
    return checkOpenClawProfile(profile, paths);
  }
  return checkHermesProfile(profile, paths);
}

export async function installTowerAgentExtension(options: TowerAgentInstallOptions): Promise<ExtensionResult> {
  const profile = options.profile || defaultTowerAgentProfile(options.gateway);
  const displayName = options.displayName || defaultTowerAgentDisplayName();
  const paths = getPaths(options.paths);
  if (options.gateway === "openclaw") {
    return installOpenClawProfile({ profile, displayName, env: options.env, paths });
  }
  return installHermesProfile({ profile, displayName, env: options.env, paths });
}

export async function uninstallTowerAgentExtension(
  gateway: TowerAgentGateway,
  options: { profile?: string; paths?: Partial<TowerAgentInstallPaths> } = {},
): Promise<ExtensionResult> {
  const profile = options.profile || defaultTowerAgentProfile(gateway);
  const paths = getPaths(options.paths);
  if (gateway === "openclaw") return uninstallOpenClawProfile(profile, paths);
  return uninstallHermesProfile(profile, paths);
}

function checkOpenClawProfile(profile: string, paths: TowerAgentInstallPaths): ExtensionStatus {
  const workspaceDir = path.join(paths.openclawWorkspacesDir, profile);
  const markerPath = path.join(workspaceDir, ".tower-agent.json");
  if (!fs.existsSync(markerPath)) return { installed: false };
  const version = readJson<{ version?: string }>(markerPath)?.version;
  return { installed: true, path: workspaceDir, version };
}

function checkHermesProfile(profile: string, paths: TowerAgentInstallPaths): ExtensionStatus {
  const profileDir = path.join(paths.hermesProfilesDir, profile);
  const markerPath = path.join(profileDir, ".tower-agent.json");
  if (!fs.existsSync(markerPath)) return { installed: false };
  const version = readJson<{ version?: string }>(markerPath)?.version;
  return { installed: true, path: profileDir, version };
}

function installOpenClawProfile(input: {
  profile: string;
  displayName: string;
  env?: Record<string, string>;
  paths: TowerAgentInstallPaths;
}): ExtensionResult {
  try {
    const resourceDir = getTowerAgentResourceDir(input.paths.packageRoot);
    const workspaceDir = path.join(input.paths.openclawWorkspacesDir, input.profile);
    const agentDir = path.join(input.paths.openclawAgentsDir, input.profile, "agent");
    const markerPath = path.join(workspaceDir, ".tower-agent.json");
    const previousEnvKeys = readJson<TowerAgentMarker>(markerPath)?.envKeys ?? [];
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });

    copyAgentFiles(resourceDir, workspaceDir);
    copyTowerSkills(path.join(workspaceDir, "skills"));
    writeMcpConfig(path.join(workspaceDir, "mcp.json"));
    writeEnvFile(path.join(workspaceDir, "gateway.env"), input.env);
    writeMarker(markerPath, {
      gateway: "openclaw",
      profile: input.profile,
      displayName: input.displayName,
      version: TOWER_AGENT_PACKAGE_VERSION,
      envKeys: Object.keys(input.env ?? {}).sort(),
    });

    upsertOpenClawAgent(input.paths.openclawConfigPath, {
      id: input.profile,
      name: input.profile,
      workspace: workspaceDir,
      agentDir,
      identity: { name: input.displayName, emoji: "🗼" },
    });
    upsertOpenClawConfigEnv(input.paths.openclawConfigPath, input.env, previousEnvKeys);
    upsertShellExportEnv(input.paths.openclawGatewayServiceEnvPath, input.env, previousEnvKeys);

    return { success: true, message: `Installed Tower Agent profile ${input.profile} for OpenClaw` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function installHermesProfile(input: {
  profile: string;
  displayName: string;
  env?: Record<string, string>;
  paths: TowerAgentInstallPaths;
}): Promise<ExtensionResult> {
  try {
    const resourceDir = getTowerAgentResourceDir(input.paths.packageRoot);
    const profileDir = path.join(input.paths.hermesProfilesDir, input.profile);
    fs.mkdirSync(profileDir, { recursive: true });
    copyAgentFiles(resourceDir, profileDir);
    writeEnvFile(path.join(profileDir, "gateway.env"), input.env);
    writeMarker(path.join(profileDir, ".tower-agent.json"), {
      gateway: "hermes",
      profile: input.profile,
      displayName: input.displayName,
      version: TOWER_AGENT_PACKAGE_VERSION,
    });

    const report = await installHermesGateway(input.profile);
    if (!report.ok) {
      return {
        success: false,
        error: report.skill?.error || report.mcp?.error || "Hermes profile files were written, but MCP/skill installation failed",
      };
    }
    return { success: true, message: `Installed Tower Agent profile ${input.profile} for Hermes` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function uninstallOpenClawProfile(profile: string, paths: TowerAgentInstallPaths): ExtensionResult {
  try {
    fs.rmSync(path.join(paths.openclawWorkspacesDir, profile), { recursive: true, force: true });
    removeOpenClawAgent(paths.openclawConfigPath, profile);
    return { success: true, message: `Removed OpenClaw Tower Agent profile ${profile}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function uninstallHermesProfile(profile: string, paths: TowerAgentInstallPaths): ExtensionResult {
  try {
    const profileDir = path.join(paths.hermesProfilesDir, profile);
    const markerPath = path.join(profileDir, ".tower-agent.json");
    if (fs.existsSync(markerPath)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
    return { success: true, message: `Removed Hermes Tower Agent profile ${profile}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function copyAgentFiles(resourceDir: string, targetDir: string): void {
  const agentDir = path.join(resourceDir, "agent");
  for (const name of ["SOUL.md", "AGENTS.md", "TOOLS.md"]) {
    fs.copyFileSync(path.join(agentDir, name), path.join(targetDir, name));
  }
}

function copyTowerSkills(targetSkillsDir: string): void {
  fs.mkdirSync(targetSkillsDir, { recursive: true });
  for (const skill of TOWER_GATEWAY_SKILL_NAMES) {
    const source = getTowerSkillSourceDir(skill);
    const target = path.join(targetSkillsDir, skill);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(source, target, { recursive: true });
  }
}

function writeMcpConfig(targetPath: string): void {
  const cfg = buildTowerMcpConfig();
  fs.writeFileSync(
    targetPath,
    JSON.stringify({ mcpServers: { [cfg.name]: { command: cfg.command, args: cfg.args, env: cfg.env ?? {} } } }, null, 2) + "\n",
    "utf-8",
  );
}

function writeEnvFile(targetPath: string, env: Record<string, string> | undefined): void {
  const lines = [
    "# Optional gateway runtime env for this Tower Agent profile.",
    "# Tower does not guess proxy rules. Fill these only when your network needs them.",
  ];
  for (const [key, value] of Object.entries(env ?? {})) {
    lines.push(`${key}=${JSON.stringify(value)}`);
  }
  fs.writeFileSync(targetPath, `${lines.join("\n")}\n`, "utf-8");
}

function writeMarker(targetPath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(targetPath, JSON.stringify({ ...data, installedAt: new Date().toISOString() }, null, 2) + "\n", "utf-8");
}

function upsertOpenClawAgent(configPath: string, agent: Record<string, unknown>): void {
  const cfg = readJson<OpenClawConfig>(configPath) ?? {};
  const agents = cfg.agents && typeof cfg.agents === "object" ? cfg.agents : {};
  const list = Array.isArray(agents.list) ? agents.list : [];
  const existing = list.find((item) => item.id === agent.id);
  const nextList = list.filter((item) => item.id !== agent.id);
  nextList.push({ ...(existing ?? {}), ...agent });
  cfg.agents = { ...agents, list: nextList };
  writeJsonWithBackup(configPath, cfg);
}

function upsertOpenClawConfigEnv(configPath: string, env: Record<string, string> | undefined, previousEnvKeys: string[] = []): void {
  const entries = Object.entries(env ?? {});
  if (entries.length === 0 && previousEnvKeys.length === 0) return;
  const cfg = readJson<OpenClawConfig>(configPath) ?? {};
  const currentEnv = cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env) ? cfg.env : {};
  const currentVars =
    "vars" in currentEnv && typeof currentEnv.vars === "object" && currentEnv.vars !== null && !Array.isArray(currentEnv.vars)
      ? (currentEnv.vars as Record<string, unknown>)
      : {};
  const nextVars = { ...currentVars };
  const nextEnv = Object.fromEntries(entries);
  for (const key of previousEnvKeys) {
    if (!(key in nextEnv)) delete nextVars[key];
  }
  cfg.env = { ...currentEnv, vars: { ...nextVars, ...nextEnv } };
  writeJsonWithBackup(configPath, cfg);
}

function upsertShellExportEnv(file: string, env: Record<string, string> | undefined, previousEnvKeys: string[] = []): void {
  const entries = Object.entries(env ?? {});
  if (entries.length === 0 && previousEnvKeys.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  const lines = original ? original.split(/\r?\n/) : ["# Generated by OpenClaw. Updated by Tower with user-provided gateway env."];
  const seen = new Set<string>();
  const next = lines.flatMap((line) => {
    const match = line.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match) return [line];
    const key = match[1];
    if (!(key in (env ?? {}))) {
      return previousEnvKeys.includes(key) ? [] : [line];
    }
    seen.add(key);
    return [`export ${key}=${shellQuote(env![key])}`];
  });
  for (const [key, value] of entries) {
    if (!seen.has(key)) next.push(`export ${key}=${shellQuote(value)}`);
  }
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.bak-tower-agent`);
  }
  fs.writeFileSync(file, `${next.join("\n").replace(/\n+$/, "")}\n`, "utf-8");
}

function removeOpenClawAgent(configPath: string, profile: string): void {
  const cfg = readJson<OpenClawConfig>(configPath);
  if (!cfg?.agents || !Array.isArray(cfg.agents.list)) return;
  cfg.agents.list = cfg.agents.list.filter((item) => item.id !== profile);
  writeJsonWithBackup(configPath, cfg);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function writeJsonWithBackup(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.bak-tower-agent`);
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
