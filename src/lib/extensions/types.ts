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

export interface Extension {
  id: ExtensionId;
  name: string;
  description: string;
  icon: LucideIcon;
  sizeMB: number;
  homepageUrl: string;
  check(): Promise<ExtensionStatus>;
  install(): Promise<ExtensionResult>;
  uninstall?(): Promise<ExtensionResult>;
}
