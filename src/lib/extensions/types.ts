import type { LucideIcon } from "lucide-react";

export type ExtensionId = "rg" | "monaco";

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
  name: string;
  description: string;
  icon: LucideIcon;
  sizeMB: number;
  homepageUrl: string;
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
