import { readConfigValue } from "@/lib/config-reader";
import type { HarnessGateway } from "./gateway-send";

export const HARNESS_GATEWAY_CONFIG_KEY = "harness.gatewayConfig";

export interface HarnessGatewayRuntimeConfig {
  profile?: string;
  displayName?: string;
  env?: Record<string, string>;
  accessPolicy?: HarnessGatewayAccessPolicy;
}

export interface HarnessGatewayAccessPolicy {
  ownerIds?: Record<string, string[]>;
  trustedChannels?: Record<string, string[]>;
  channelScopes?: Record<string, Record<string, string>>;
}

export type HarnessGatewayConfigMap = Partial<Record<HarnessGateway, HarnessGatewayRuntimeConfig>>;

function cleanEnv(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (raw === undefined || raw === null) continue;
    env[key] = String(raw);
  }
  return env;
}

function cleanConfig(value: unknown): HarnessGatewayRuntimeConfig {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const profile = typeof raw.profile === "string" ? raw.profile.trim() : "";
  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
  const env = cleanEnv(raw.env);
  const accessPolicy = cleanAccessPolicy(raw.accessPolicy);
  return {
    ...(profile ? { profile } : {}),
    ...(displayName ? { displayName } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    ...(accessPolicy ? { accessPolicy } : {}),
  };
}

function cleanIdMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [rawPlatform, rawIds] of Object.entries(value as Record<string, unknown>)) {
    const platform = rawPlatform.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(platform) || !Array.isArray(rawIds)) continue;
    const ids = [...new Set(rawIds
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean))];
    if (ids.length > 0) result[platform] = ids;
  }
  return result;
}

function cleanAccessPolicy(value: unknown): HarnessGatewayAccessPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const ownerIds = cleanIdMap(raw.ownerIds);
  const trustedChannels = cleanIdMap(raw.trustedChannels);
  const channelScopes = cleanChannelScopes(raw.channelScopes);
  if (
    Object.keys(ownerIds).length === 0
    && Object.keys(trustedChannels).length === 0
    && Object.keys(channelScopes).length === 0
  ) return undefined;
  return {
    ...(Object.keys(ownerIds).length > 0 ? { ownerIds } : {}),
    ...(Object.keys(trustedChannels).length > 0 ? { trustedChannels } : {}),
    ...(Object.keys(channelScopes).length > 0 ? { channelScopes } : {}),
  };
}

function cleanChannelScopes(value: unknown): Record<string, Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, Record<string, string>> = {};
  for (const [rawPlatform, rawScopes] of Object.entries(value as Record<string, unknown>)) {
    const platform = rawPlatform.trim().toLowerCase();
    if (
      !/^[a-z][a-z0-9_-]{0,63}$/.test(platform)
      || !rawScopes
      || typeof rawScopes !== "object"
      || Array.isArray(rawScopes)
    ) continue;
    for (const [rawChatId, rawWorkspace] of Object.entries(rawScopes as Record<string, unknown>)) {
      const chatId = rawChatId.trim();
      const workspace = typeof rawWorkspace === "string" ? rawWorkspace.trim() : "";
      if (!chatId || !workspace) continue;
      result[platform] ??= {};
      result[platform][chatId] = workspace;
    }
  }
  return result;
}

export async function readHarnessGatewayConfigMap(): Promise<HarnessGatewayConfigMap> {
  const explicit = await readConfigValue<Record<string, unknown>>(HARNESS_GATEWAY_CONFIG_KEY, {});
  const map: HarnessGatewayConfigMap = {
    hermes: cleanConfig(explicit.hermes),
    openclaw: cleanConfig(explicit.openclaw),
  };

  // Legacy compatibility: earlier builds stored profile/env on harness.targets.
  // Treat those as a fallback only; new writes live in harness.gatewayConfig.
  const targets = await readConfigValue<Array<{ gateway?: string; profile?: string; env?: unknown }>>("harness.targets", []);
  for (const gateway of ["hermes", "openclaw"] as const) {
    if (map[gateway]?.profile || map[gateway]?.env) continue;
    const legacy = (Array.isArray(targets) ? targets : []).find(
      (target) => target.gateway?.trim().toLowerCase() === gateway && (target.profile || target.env),
    );
    // Merge (legacy fills only the missing profile/env), never overwrite: the
    // explicit config's accessPolicy/ownerIds must survive a legacy backfill,
    // otherwise a config carrying ownerIds but no profile/env silently loses
    // its whitelist and drops every sender to NON_OWNER.
    if (legacy) map[gateway] = { ...cleanConfig(legacy), ...map[gateway] };
  }

  return map;
}

export async function readHarnessGatewayRuntimeConfig(
  gateway: HarnessGateway,
): Promise<HarnessGatewayRuntimeConfig> {
  const map = await readHarnessGatewayConfigMap();
  return map[gateway] ?? {};
}
