export type ExtensionKind =
  | "tower-component"
  | "cli-provider"
  | "gateway-adapter"
  | "system-dependency";

export type ExtensionSourceType =
  | "builtin"
  | "official-catalog"
  | "catalog"
  | "local-development"
  | "system";

export type ExtensionTrust = "tower" | "verified" | "unverified";
export type ExtensionCompatibility = "compatible" | "incompatible" | "unknown";
export type ExtensionHealth = "ready" | "degraded" | "error" | "unknown";

export interface ExtensionDisplay {
  name: string;
  description: string;
  homepage?: string;
  iconKey?: string;
}

export interface ExtensionDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface ExtensionLifecycle {
  install: boolean;
  configure: boolean;
  enable: boolean;
  disable: boolean;
  update: boolean;
  repair: boolean;
  remove: boolean;
}

export interface ExtensionDeploymentState {
  targetId: string;
  installed: boolean;
  health: ExtensionHealth;
  version?: string;
  diagnostics: ExtensionDiagnostic[];
}

export interface ExtensionInventoryItem {
  id: string;
  legacyIds?: string[];
  kind: ExtensionKind;
  display: ExtensionDisplay;
  source: {
    type: ExtensionSourceType;
    catalogId?: string;
    publisherId?: string;
    trust: ExtensionTrust;
  };
  installed: null | {
    version: string | null;
    enabled: boolean;
  };
  available: null | {
    version: string;
  };
  compatibility: ExtensionCompatibility;
  health: ExtensionHealth;
  capabilities: string[];
  lifecycle: ExtensionLifecycle;
  deployments?: ExtensionDeploymentState[];
  diagnostics: ExtensionDiagnostic[];
}

