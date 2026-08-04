import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPackageRoot } from "@/lib/tower-paths";
import { buildTowerMcpConfig, getTowerSkillSourceDir, installHermesGateway } from "@/lib/ai/install-orchestrator";
import type { ExtensionResult, ExtensionStatus } from "./types";
import type { HarnessGatewayAccessPolicy } from "@/lib/harness/gateway-config";
import { gatewayOwnerToolNames, gatewayQueryToolNames } from "@/mcp/tool-capabilities";

export type TowerAgentGateway = "openclaw" | "hermes";

const TOWER_AGENT_PACKAGE_VERSION = "7";
const OPENCLAW_CAPABILITY_PLUGIN_ID = "tower-capability-bridge";
const TOWER_GATEWAY_SKILL_NAMES = ["tower"] as const;
const OPENCLAW_PROJECT_READER_TOOLS = gatewayQueryToolNames.map((name) => `tower__${name}`);
const OPENCLAW_OWNER_GATEWAY_TOOLS = gatewayOwnerToolNames.map((name) => `tower__${name}`);
const OPENCLAW_OPERATOR_DELEGATION_TOOLS = ["agents_list", "sessions_send", "message"] as const;
const OPENCLAW_TOWER_GROUP_PROMPT =
  "Use only the Tower tools exposed for the verified sender. Ordinary Q&A and third-party/operator requests " +
  "stay in OpenClaw and must not be persisted or routed through Tower. Tower-related non-reply messages use " +
  "tower__route_gateway_message. A reply to a Tower delivery must first use tower__resolve_gateway_task_context; " +
  "finding a task never authorizes terminal resume. Read-only status questions use query tools without continuation, " +
  "open ask_human answers use tower__reply_to_ask. For an OWNER request that needs a computer, browser, SaaS, " +
  "or another external system, discover only the configured private Operator with agents_list, then send exactly one " +
  "request to its peer main session with sessions_send and wait up to 240 seconds for the inline result. Give the Operator " +
  "the user's exact request plus read-only Tower context when relevant; return its result and evidence without " +
  "revealing the private agent id. Validate that observed values and evidence satisfy the request; an Operator status " +
  "alone is not proof. For returned screenshots, require the Operator to publish each file into OpenClaw's channel-safe " +
  "media cache, then use the message tool with action=send and media set to that absolute path. Include the user-facing " +
  "summary in the same structured reply; after a successful message reply, finish with NO_REPLY so it is not duplicated. " +
  "Never emit a textual MEDIA directive and never route " +
  "this external work through Tower and never claim success before the Operator result arrives. " +
  "and only an explicit continue/fix/rerun request uses tower__continue_bound_task. " +
  "OWNER requests for new project work or Tower mutations other than a bound continuation use " +
  "tower__route_gateway_message with intent PROJECT_WORK; computer/operator state is outside Tower. " +
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
  openclawExtensionsDir: string;
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
  plugins?: {
    allow?: string[];
    entries?: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
  };
  tools?: Record<string, unknown>;
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
    openclawExtensionsDir: overrides.openclawExtensionsDir ?? path.join(homeDir, ".openclaw", "extensions"),
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
    installOpenClawCapabilityPlugin(resourceDir, input.paths);
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

    const operatorAgentIds = configuredOpenClawOperatorAgentIds(input.paths.openclawConfigPath);
    upsertOpenClawAgent(input.paths.openclawConfigPath, {
      id: input.profile,
      name: input.profile,
      workspace: workspaceDir,
      agentDir,
      identity: { name: input.displayName, emoji: "🗼" },
      subagents: { allowAgents: operatorAgentIds, requireAgentId: true },
      tools: hasAccessPolicy
        ? buildOpenClawTowerToolPolicy(accessPolicy, operatorAgentIds.length > 0)
        : disabledOpenClawTowerToolPolicy(),
    });
    if (operatorAgentIds.length > 0) {
      enableOpenClawPeerDelegation(input.paths.openclawConfigPath, input.profile, operatorAgentIds);
    }
    enableOpenClawCapabilityPlugin(input.paths.openclawConfigPath);
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

function buildOpenClawTowerToolPolicy(
  policy: HarnessGatewayAccessPolicy,
  operatorDelegationEnabled = false,
): Record<string, unknown> {
  const { owners } = normalizedAccessEntries(policy);
  const delegationTools = operatorDelegationEnabled ? [...OPENCLAW_OPERATOR_DELEGATION_TOOLS] : [];
  const allGatewayTools = Array.from(new Set([
    ...OPENCLAW_PROJECT_READER_TOOLS,
    ...OPENCLAW_OWNER_GATEWAY_TOOLS,
    ...delegationTools,
  ]));
  const toolsBySender: Record<string, { allow: string[] }> = {
    "*": { allow: [...OPENCLAW_PROJECT_READER_TOOLS] },
  };
  for (const owner of owners) {
    toolsBySender[`channel:${owner.platform}:${owner.id}`] = {
      allow: [...OPENCLAW_OWNER_GATEWAY_TOOLS, ...delegationTools, "session_status"],
    };
  }
  return {
    profile: "minimal",
    alsoAllow: allGatewayTools,
    toolsBySender,
    elevated: { enabled: false },
  };
}

function configuredOpenClawOperatorAgentIds(configPath: string): string[] {
  const cfg = readJson<OpenClawConfig>(configPath);
  const entry = cfg?.plugins?.entries?.[OPENCLAW_CAPABILITY_PLUGIN_ID];
  const config = entry?.config;
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const capabilities = (config as Record<string, unknown>).capabilities;
  if (!Array.isArray(capabilities)) return [];
  return Array.from(new Set(capabilities.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const agentId = (value as Record<string, unknown>).agentId;
    return typeof agentId === "string" && agentId.trim() ? [agentId.trim()] : [];
  }))).sort();
}

function enableOpenClawPeerDelegation(configPath: string, profile: string, operatorAgentIds: string[]): void {
  const cfg = readJson<OpenClawConfig>(configPath) ?? {};
  const tools = cfg.tools && typeof cfg.tools === "object" && !Array.isArray(cfg.tools) ? cfg.tools : {};
  const currentA2A = tools.agentToAgent && typeof tools.agentToAgent === "object" && !Array.isArray(tools.agentToAgent)
    ? tools.agentToAgent as Record<string, unknown>
    : {};
  const currentAllow = Array.isArray(currentA2A.allow)
    ? currentA2A.allow.filter((value): value is string => typeof value === "string")
    : [];
  const currentSessions = tools.sessions && typeof tools.sessions === "object" && !Array.isArray(tools.sessions)
    ? tools.sessions as Record<string, unknown>
    : {};
  const currentAlsoAllow = Array.isArray(tools.alsoAllow)
    ? tools.alsoAllow.filter((value): value is string => typeof value === "string")
    : [];
  cfg.tools = {
    ...tools,
    // Embedded OpenClaw runs only construct the message tool when the global
    // factory policy admits it. Agent and sender policies below still decide
    // whether a particular turn may use it.
    alsoAllow: Array.from(new Set([...currentAlsoAllow, "message"])).sort(),
    agentToAgent: {
      ...currentA2A,
      enabled: true,
      allow: Array.from(new Set([...currentAllow, profile, ...operatorAgentIds])).sort(),
    },
    sessions: { ...currentSessions, visibility: "all" },
  };
  writeJsonWithBackup(configPath, cfg);
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
    const platformEnabled = platformOwners.length > 0 || platformChannels.length > 0;
    const existingGroups = current.groups && typeof current.groups === "object" && !Array.isArray(current.groups)
      ? current.groups as Record<string, unknown>
      : {};
    const groups: Record<string, unknown> = { ...existingGroups };
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
    const wildcard = existingGroups["*"] && typeof existingGroups["*"] === "object" && !Array.isArray(existingGroups["*"])
      ? existingGroups["*"] as Record<string, unknown>
      : {};
    groups["*"] = {
      ...wildcard,
      enabled: true,
      requireMention: true,
      systemPrompt: OPENCLAW_TOWER_GROUP_PROMPT,
    };
    channelRoot[platform] = {
      ...current,
      dmPolicy: platformOwners.length > 0 ? "allowlist" : "disabled",
      allowFrom: platformOwners,
      // OpenClaw admits mentioned group messages; Tower's gateway-query path
      // makes the authoritative per-channel and project-scope decision.
      groupPolicy: platformEnabled ? "open" : "disabled",
      groupSenderAllowFrom: platformEnabled ? ["*"] : [],
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
  const enabledPlatforms = new Set([
    ...owners.map((item) => item.platform),
    ...channels.map((item) => item.platform),
  ]);
  const managedBindings = Array.from(platforms)
    .filter((platform) => enabledPlatforms.has(platform))
    .map((platform) => ({
      type: "route",
      agentId: profile,
      match: { channel: platform },
    }));
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
    if (!hasOtherOpenClawTowerProfiles(paths, profile)) {
      removeOpenClawCapabilityPlugin(paths.openclawConfigPath);
      fs.rmSync(path.join(paths.openclawExtensionsDir, OPENCLAW_CAPABILITY_PLUGIN_ID), {
        recursive: true,
        force: true,
      });
    }
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

function installOpenClawCapabilityPlugin(resourceDir: string, paths: TowerAgentInstallPaths): void {
  const source = path.join(resourceDir, "openclaw-capability");
  if (!fs.existsSync(path.join(source, "openclaw.plugin.json"))) {
    throw new Error("Tower OpenClaw capability plugin is missing from the package");
  }
  const target = path.join(paths.openclawExtensionsDir, OPENCLAW_CAPABILITY_PLUGIN_ID);
  fs.mkdirSync(paths.openclawExtensionsDir, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

function enableOpenClawCapabilityPlugin(configPath: string): void {
  const cfg = readJson<OpenClawConfig>(configPath) ?? {};
  const plugins = cfg.plugins && typeof cfg.plugins === "object" ? cfg.plugins : {};
  const entries = plugins.entries && typeof plugins.entries === "object" ? plugins.entries : {};
  const current = entries[OPENCLAW_CAPABILITY_PLUGIN_ID] ?? {};
  const allow = Array.isArray(plugins.allow)
    ? plugins.allow.filter((id): id is string => typeof id === "string")
    : null;
  cfg.plugins = {
    ...plugins,
    ...(allow ? { allow: Array.from(new Set([...allow, OPENCLAW_CAPABILITY_PLUGIN_ID])) } : {}),
    entries: {
      ...entries,
      [OPENCLAW_CAPABILITY_PLUGIN_ID]: { ...current, enabled: true },
    },
  };
  writeJsonWithBackup(configPath, cfg);
}

function removeOpenClawCapabilityPlugin(configPath: string): void {
  const cfg = readJson<OpenClawConfig>(configPath);
  if (!cfg?.plugins) return;
  const entries = { ...(cfg.plugins.entries ?? {}) };
  delete entries[OPENCLAW_CAPABILITY_PLUGIN_ID];
  cfg.plugins = {
    ...cfg.plugins,
    allow: Array.isArray(cfg.plugins.allow)
      ? cfg.plugins.allow.filter((id) => id !== OPENCLAW_CAPABILITY_PLUGIN_ID)
      : cfg.plugins.allow,
    entries,
  };
  writeJsonWithBackup(configPath, cfg);
}

function hasOtherOpenClawTowerProfiles(paths: TowerAgentInstallPaths, removedProfile: string): boolean {
  if (!fs.existsSync(paths.openclawWorkspacesDir)) return false;
  return fs.readdirSync(paths.openclawWorkspacesDir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
    && entry.name !== removedProfile
    && fs.existsSync(path.join(paths.openclawWorkspacesDir, entry.name, ".tower-agent.json"))
  );
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
  const cfg = buildTowerMcpConfig({ profile: "gateway" });
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
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", "utf-8");
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
  }
}
