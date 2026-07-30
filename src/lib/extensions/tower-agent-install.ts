import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPackageRoot } from "@/lib/tower-paths";
import { buildTowerMcpConfig, getTowerSkillSourceDir, installHermesGateway } from "@/lib/ai/install-orchestrator";
import type { ExtensionResult, ExtensionStatus } from "./types";
import type { HarnessGatewayAccessPolicy } from "@/lib/harness/gateway-config";

export type TowerAgentGateway = "openclaw" | "hermes";

const TOWER_AGENT_PACKAGE_VERSION = "3";
const TOWER_GATEWAY_SKILL_NAMES = ["tower"] as const;
const OPENCLAW_PROJECT_READER_TOOLS = [
  "tower__route_gateway_query",
  "tower__read_gateway_project_context",
  "tower__complete_gateway_discussion",
] as const;
const OPENCLAW_OWNER_GATEWAY_TOOLS = [
  "tower__route_gateway_message",
  "tower__route_gateway_query",
  "tower__read_gateway_project_context",
  "tower__complete_gateway_discussion",
  "tower__identify_project",
  "tower__list_workspaces",
  "tower__list_projects",
  "tower__list_product_groups",
  "tower__list_tasks",
  "tower__list_labels",
  "tower__list_versions",
  "tower__search",
  "tower__daily_summary",
  "tower__daily_todo",
  "tower__ask_project_knowledge",
  "tower__get_task_execution_status",
  "tower__get_task_terminal_output",
  "tower__get_gateway_runtime_health",
  "tower__diagnose_gateway_request",
  "tower__recover_gateway_request",
  "tower__provision_remote_project",
] as const;
const OPENCLAW_TOWER_GROUP_PROMPT =
  "Use only the Tower tools exposed for the verified sender. Every inbound message must be routed first. " +
  "OWNER project work and every request that creates, changes, deletes, starts, stops, clones, provisions, " +
  "or otherwise mutates Tower/computer state must use tower__route_gateway_message with intent PROJECT_WORK; " +
  "after it returns project_work, stop the turn with NO_REPLY because the resident Workbench exclusively owns " +
  "task creation, execution, review, and external callbacks. Never call a direct mutation tool from this ingress " +
  "agent, never retry by omitting gatewayInboundId, and never start a second task for a queued request. " +
  "For read-only project questions, route through tower__route_gateway_query, read only the returned bound " +
  "project context, and finish with tower__complete_gateway_discussion. NON_OWNER senders are read-only. " +
  "Never claim that a task, terminal action, computer action, or project mutation occurred unless Tower's " +
  "durable gateway path reports it.";

export interface TowerAgentInstallOptions {
  gateway: TowerAgentGateway;
  profile?: string;
  displayName?: string;
  env?: Record<string, string>;
  accessPolicy?: HarnessGatewayAccessPolicy;
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
  channels?: Record<string, unknown>;
  bindings?: unknown[];
  [key: string]: unknown;
}

interface TowerAgentMarker {
  envKeys?: string[];
  managedPlatforms?: string[];
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
    return installOpenClawProfile({
      profile,
      displayName,
      env: options.env,
      accessPolicy: options.accessPolicy,
      paths,
    });
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
  accessPolicy?: HarnessGatewayAccessPolicy;
  paths: TowerAgentInstallPaths;
}): ExtensionResult {
  try {
    const resourceDir = getTowerAgentResourceDir(input.paths.packageRoot);
    const workspaceDir = path.join(input.paths.openclawWorkspacesDir, input.profile);
    const agentDir = path.join(input.paths.openclawAgentsDir, input.profile, "agent");
    const markerPath = path.join(workspaceDir, ".tower-agent.json");
    const previousMarker = readJson<TowerAgentMarker>(markerPath);
    const previousEnvKeys = previousMarker?.envKeys ?? [];
    const accessPolicy = input.accessPolicy ?? {};
    const normalizedPolicy = normalizedAccessEntries(accessPolicy);
    const hasAccessPolicy = normalizedPolicy.owners.length > 0 || normalizedPolicy.channels.length > 0;
    const managedPlatforms = Array.from(new Set([
      ...(previousMarker?.managedPlatforms ?? []),
      ...policyPlatforms(accessPolicy),
    ])).sort();
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
      managedPlatforms: policyPlatforms(accessPolicy),
    });

    upsertOpenClawAgent(input.paths.openclawConfigPath, {
      id: input.profile,
      name: input.profile,
      workspace: workspaceDir,
      agentDir,
      identity: { name: input.displayName, emoji: "🗼" },
      tools: hasAccessPolicy
        ? buildOpenClawTowerToolPolicy(accessPolicy)
        : disabledOpenClawTowerToolPolicy(),
    });
    upsertOpenClawAccessPolicy(
      input.paths.openclawConfigPath,
      input.profile,
      accessPolicy,
      managedPlatforms,
    );
    upsertOpenClawConfigEnv(input.paths.openclawConfigPath, input.env, previousEnvKeys);
    upsertShellExportEnv(input.paths.openclawGatewayServiceEnvPath, input.env, previousEnvKeys);

    return { success: true, message: `Installed Tower Agent profile ${input.profile} for OpenClaw` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function normalizedAccessEntries(policy: HarnessGatewayAccessPolicy): {
  owners: Array<{ platform: string; id: string }>;
  channels: Array<{ platform: string; id: string }>;
} {
  const owners = Object.entries(policy.ownerIds ?? {}).flatMap(([platform, ids]) =>
    ids.map((id) => ({ platform: platform.trim().toLowerCase(), id: id.trim() }))
  ).filter((item) => item.platform && item.id);
  const channels = Object.entries(policy.trustedChannels ?? {}).flatMap(([platform, ids]) =>
    ids.map((id) => ({ platform: platform.trim().toLowerCase(), id: id.trim() }))
  ).filter((item) => item.platform && item.id);
  return { owners, channels };
}

function policyPlatforms(policy: HarnessGatewayAccessPolicy): string[] {
  const { owners, channels } = normalizedAccessEntries(policy);
  return Array.from(new Set([
    ...owners.map((item) => item.platform),
    ...channels.map((item) => item.platform),
  ])).sort();
}

function disabledOpenClawTowerToolPolicy(): Record<string, unknown> {
  return {
    profile: "minimal",
    alsoAllow: [],
    toolsBySender: { "*": { allow: [] } },
    elevated: { enabled: false },
  };
}

function buildOpenClawTowerToolPolicy(policy: HarnessGatewayAccessPolicy): Record<string, unknown> {
  const { owners } = normalizedAccessEntries(policy);
  const allGatewayTools = Array.from(new Set([
    ...OPENCLAW_PROJECT_READER_TOOLS,
    ...OPENCLAW_OWNER_GATEWAY_TOOLS,
  ]));
  const toolsBySender: Record<string, { allow: string[] }> = {
    "*": { allow: [...OPENCLAW_PROJECT_READER_TOOLS] },
  };
  for (const owner of owners) {
    toolsBySender[`channel:${owner.platform}:${owner.id}`] = {
      allow: [...OPENCLAW_OWNER_GATEWAY_TOOLS, "session_status"],
    };
  }
  return {
    profile: "minimal",
    alsoAllow: allGatewayTools,
    toolsBySender,
    elevated: { enabled: false },
  };
}

function upsertOpenClawAccessPolicy(
  configPath: string,
  profile: string,
  policy: HarnessGatewayAccessPolicy,
  previouslyManagedPlatforms: string[] = [],
): void {
  const cfg = readJson<OpenClawConfig>(configPath) ?? {};
  const { owners, channels } = normalizedAccessEntries(policy);
  const platforms = new Set([
    ...previouslyManagedPlatforms.map((platform) => platform.trim().toLowerCase()).filter(Boolean),
    ...owners.map((item) => item.platform),
    ...channels.map((item) => item.platform),
  ]);
  for (const binding of Array.isArray(cfg.bindings) ? cfg.bindings : []) {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) continue;
    const row = binding as Record<string, unknown>;
    if (row.agentId !== profile) continue;
    const match = row.match && typeof row.match === "object" && !Array.isArray(row.match)
      ? row.match as Record<string, unknown>
      : {};
    const platform = String(match.channel ?? "").trim().toLowerCase();
    if (platform) platforms.add(platform);
  }
  const channelRoot = cfg.channels && typeof cfg.channels === "object" && !Array.isArray(cfg.channels)
    ? cfg.channels as Record<string, unknown>
    : {};
  for (const platform of platforms) {
    const current = channelRoot[platform] && typeof channelRoot[platform] === "object" && !Array.isArray(channelRoot[platform])
      ? channelRoot[platform] as Record<string, unknown>
      : {};
    const platformOwners = owners.filter((item) => item.platform === platform).map((item) => item.id);
    const platformChannels = channels.filter((item) => item.platform === platform).map((item) => item.id);
    const existingGroups = current.groups && typeof current.groups === "object" && !Array.isArray(current.groups)
      ? current.groups as Record<string, unknown>
      : {};
    const groups: Record<string, unknown> = {};
    for (const chatId of platformChannels) {
      const existing = existingGroups[chatId] && typeof existingGroups[chatId] === "object" && !Array.isArray(existingGroups[chatId])
        ? existingGroups[chatId] as Record<string, unknown>
        : {};
      groups[chatId] = {
        ...existing,
        enabled: true,
        requireMention: true,
        systemPrompt: OPENCLAW_TOWER_GROUP_PROMPT,
      };
    }
    channelRoot[platform] = {
      ...current,
      dmPolicy: platformOwners.length > 0 ? "allowlist" : "disabled",
      allowFrom: platformOwners,
      groupPolicy: platformChannels.length > 0 ? "allowlist" : "disabled",
      groupSenderAllowFrom: platformChannels.length > 0 ? ["*"] : [],
      groups,
    };
  }
  cfg.channels = channelRoot;

  const existingBindings = Array.isArray(cfg.bindings)
    ? cfg.bindings.filter((binding) => {
        if (!binding || typeof binding !== "object" || Array.isArray(binding)) return true;
        const row = binding as Record<string, unknown>;
        return row.agentId !== profile;
      })
    : [];
  const managedBindings = [
    ...owners.map(({ platform, id }) => ({
      type: "route",
      agentId: profile,
      match: { channel: platform, peer: { kind: "direct", id } },
    })),
    ...channels.map(({ platform, id }) => ({
      type: "route",
      agentId: profile,
      match: { channel: platform, peer: { kind: "group", id } },
    })),
  ];
  const bindingKey = (binding: unknown) => JSON.stringify(binding);
  const seen = new Set(existingBindings.map(bindingKey));
  cfg.bindings = [
    ...existingBindings,
    ...managedBindings.filter((binding) => {
      const key = bindingKey(binding);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
  writeJsonWithBackup(configPath, cfg);
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
    const workspaceDir = path.join(paths.openclawWorkspacesDir, profile);
    const marker = readJson<TowerAgentMarker>(path.join(workspaceDir, ".tower-agent.json"));
    removeOpenClawIntegration(
      paths.openclawConfigPath,
      profile,
      marker?.managedPlatforms ?? [],
      marker?.envKeys ?? [],
    );
    upsertShellExportEnv(paths.openclawGatewayServiceEnvPath, undefined, marker?.envKeys ?? []);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(path.join(paths.openclawAgentsDir, profile), { recursive: true, force: true });
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

function removeOpenClawIntegration(
  configPath: string,
  profile: string,
  managedPlatforms: string[],
  envKeys: string[],
): void {
  const cfg = readJson<OpenClawConfig>(configPath);
  if (!cfg) return;
  if (cfg.agents && Array.isArray(cfg.agents.list)) {
    cfg.agents.list = cfg.agents.list.filter((item) => item.id !== profile);
  }
  if (Array.isArray(cfg.bindings)) {
    cfg.bindings = cfg.bindings.filter((binding) =>
      !binding
      || typeof binding !== "object"
      || Array.isArray(binding)
      || (binding as Record<string, unknown>).agentId !== profile
    );
  }
  if (cfg.channels && typeof cfg.channels === "object" && !Array.isArray(cfg.channels)) {
    for (const platform of managedPlatforms) {
      const current = cfg.channels[platform];
      if (!current || typeof current !== "object" || Array.isArray(current)) continue;
      cfg.channels[platform] = {
        ...(current as Record<string, unknown>),
        dmPolicy: "disabled",
        allowFrom: [],
        groupPolicy: "disabled",
        groupSenderAllowFrom: [],
        groups: {},
      };
    }
  }
  if (cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env)) {
    const env = cfg.env as Record<string, unknown>;
    const vars = env.vars && typeof env.vars === "object" && !Array.isArray(env.vars)
      ? { ...(env.vars as Record<string, unknown>) }
      : {};
    for (const key of envKeys) delete vars[key];
    cfg.env = { ...env, vars };
  }
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
