import { readConfigValue } from "@/lib/config-reader";
import type { HarnessGateway } from "./gateway-send";

export const HARNESS_GATEWAY_CONFIG_KEY = "harness.gatewayConfig";

export interface HarnessGatewayRuntimeConfig {
  profile?: string;
  displayName?: string;
  env?: Record<string, string>;
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
  return {
    ...(profile ? { profile } : {}),
    ...(displayName ? { displayName } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
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
    if (legacy) map[gateway] = cleanConfig(legacy);
  }

  return map;
}

export async function readHarnessGatewayRuntimeConfig(
  gateway: HarnessGateway,
): Promise<HarnessGatewayRuntimeConfig> {
  const map = await readHarnessGatewayConfigMap();
  return map[gateway] ?? {};
}
