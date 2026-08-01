export const EXTENSION_MANIFEST_VERSION = 2 as const;

export type ExtensionKind =
  | "tower-component"
  | "cli-provider"
  | "gateway-adapter";

export type ExtensionPermission =
  | "process:cli"
  | "config:read"
  | "config:write"
  | "secrets:read-scoped"
  | "workspace:read"
  | "gateway:openclaw-profile"
  | "gateway:hermes-profile";

export interface ExtensionDisplay {
  name: string;
  description: string;
  homepage?: string;
  icon?: string;
}

export interface ExtensionEngines {
  tower: string;
  extensionSdk: string;
}

export interface TowerComponentEntrypoints {
  assets: string;
  activation: {
    type: "static-assets";
    mount: string;
  };
}

export interface CliProviderEntrypoints {
  provider: string;
  configSchema: string;
}

export interface GatewayAdapterEntrypoints {
  resources: string;
  deployment: string;
}

interface ExtensionManifestBase {
  manifestVersion: typeof EXTENSION_MANIFEST_VERSION;
  id: string;
  version: string;
  apiVersion: string;
  engines: ExtensionEngines;
  display: ExtensionDisplay;
  capabilities: string[];
  permissions: ExtensionPermission[];
  configuration?: {
    schema: string;
  };
}

export interface TowerComponentManifest extends ExtensionManifestBase {
  kind: "tower-component";
  entrypoints: TowerComponentEntrypoints;
}

export interface CliProviderManifest extends ExtensionManifestBase {
  kind: "cli-provider";
  entrypoints: CliProviderEntrypoints;
}

export interface GatewayAdapterManifest extends ExtensionManifestBase {
  kind: "gateway-adapter";
  entrypoints: GatewayAdapterEntrypoints;
}

export type ExtensionManifestV2 =
  | TowerComponentManifest
  | CliProviderManifest
  | GatewayAdapterManifest;

