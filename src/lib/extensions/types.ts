import type { LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n/types";

export type ExtensionId = "rg" | "monaco" | "tower-agent-openclaw" | "tower-agent-hermes";

export type LocalExtensionKind = "tower-component" | "gateway-adapter";

export type GatewayId = "openclaw" | "hermes";

export type GatewaySettingsCapability =
  | "gateway.profile"
  | "gateway.display-name"
  | "gateway.runtime-env"
  | "gateway.owner-policy"
  | "gateway.channel-access";

export type LocalExtensionCapability =
  | "code-search"
  | "code-editor"
  | GatewaySettingsCapability;

export interface ExtensionStatus {
  installed: boolean;
  version?: string;
  path?: string;
  error?: string;
}

export interface ExtensionResult {
  success: boolean;
  error?: string;
  message?: string;
}

/**
 * Client-safe extension metadata. Contains no Node-only references.
 * UI components consume this; server actions use the full {@link Extension}.
 */
export interface ExtensionMetadata {
  id: ExtensionId;
  kind: LocalExtensionKind;
  capabilities: readonly LocalExtensionCapability[];
  name: string;
  nameKey?: TranslationKey;
  description: string;
  descriptionKey?: TranslationKey;
  icon: LucideIcon;
  sizeMB: number;
  homepageUrl: string;
  /**
   * When true, Tower will NOT auto-install this extension. The UI shows
   * an info tooltip on the install button pointing users to homepageUrl.
   * Use for native binaries (ripgrep) where cross-platform auto-download
   * is unreliable in restricted networks.
   */
  manualInstall?: boolean;
  /**
   * Optional i18n key for a one-line helper text shown under the description
   * on the extension card. Use for capability/boundary hints (e.g. Tower Agent
   * delegation). Rendered via `t(hintKey)` — no hardcoded copy in the UI.
   */
  hintKey?: TranslationKey;
  /** Gateway deployment target. Required when kind is gateway-adapter. */
  gateway?: GatewayId;
}

export type GatewayAdapterExtensionMetadata = ExtensionMetadata & {
  kind: "gateway-adapter";
  gateway: GatewayId;
  capabilities: readonly GatewaySettingsCapability[];
};

const GATEWAY_SETTINGS_CAPABILITIES = new Set<GatewaySettingsCapability>([
  "gateway.profile",
  "gateway.display-name",
  "gateway.runtime-env",
  "gateway.owner-policy",
  "gateway.channel-access",
]);

export function isGatewayAdapterExtension(
  extension: ExtensionMetadata,
): extension is GatewayAdapterExtensionMetadata {
  return extension.kind === "gateway-adapter"
    && extension.gateway !== undefined
    && extension.capabilities.every((capability) =>
      GATEWAY_SETTINGS_CAPABILITIES.has(capability as GatewaySettingsCapability));
}

/**
 * Full server-side extension with action implementations. NEVER import
 * from a "use client" module — it pulls in Node modules (child_process, fs)
 * that webpack cannot resolve in client bundles.
 */
export interface Extension extends ExtensionMetadata {
  check(): Promise<ExtensionStatus>;
  install(): Promise<ExtensionResult>;
  uninstall?(): Promise<ExtensionResult>;
}
