import manifestJson from "../../../extensions/tower-agent/manifest.json";
import type { GatewayId, GatewaySettingsCapability } from "./types";

interface TowerAgentGatewayDescriptor {
  defaultProfile: string;
  defaultDisplayName: string;
  capabilities: GatewaySettingsCapability[];
}

interface TowerAgentManifest {
  id: string;
  version: number;
  kind: "gateway-adapter";
  name: string;
  description: string;
  gateways: Record<GatewayId, TowerAgentGatewayDescriptor>;
}

const CAPABILITIES = new Set<GatewaySettingsCapability>([
  "gateway.profile",
  "gateway.display-name",
  "gateway.runtime-env",
  "gateway.owner-policy",
  "gateway.channel-access",
]);

function parseTowerAgentManifest(value: unknown): TowerAgentManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid Tower Agent manifest");
  const manifest = value as Partial<TowerAgentManifest>;
  if (manifest.kind !== "gateway-adapter" || !manifest.gateways) {
    throw new Error("Tower Agent must declare kind=gateway-adapter and gateway targets");
  }

  for (const gateway of ["openclaw", "hermes"] as const) {
    const target = manifest.gateways[gateway];
    if (!target || !Array.isArray(target.capabilities)) {
      throw new Error(`Tower Agent target ${gateway} must declare capabilities`);
    }
    if (!target.capabilities.every((capability) => CAPABILITIES.has(capability))) {
      throw new Error(`Tower Agent target ${gateway} declares an unsupported capability`);
    }
  }
  return manifest as TowerAgentManifest;
}

export const towerAgentManifest = parseTowerAgentManifest(manifestJson);

export function getTowerAgentGatewayDescriptor(gateway: GatewayId): TowerAgentGatewayDescriptor {
  return towerAgentManifest.gateways[gateway];
}
