/**
 * Client-safe extension metadata. Imports lucide-react icons only — no Node
 * modules. Consumed by client components (ExtensionsSection, ExtensionCard,
 * WizardStepExtensions, ExtensionContext).
 *
 * The full Extension definitions (with check/install/uninstall) live in
 * `definitions/{ripgrep,monaco}.ts` and are server-only. The registry
 * (server-side) re-exports those; this file is the client-side counterpart.
 */
import { Search, FileCode, RadioTower, Bot } from "lucide-react";
import type { ExtensionMetadata, ExtensionId } from "./types";

const EXTENSION_METADATA: Record<ExtensionId, ExtensionMetadata> = {
  rg: {
    id: "rg",
    name: "代码搜索 (ripgrep)",
    description: "基于 rg 的全文代码搜索",
    icon: Search,
    sizeMB: 5,
    homepageUrl: "https://github.com/BurntSushi/ripgrep#installation",
    manualInstall: true,
  },
  monaco: {
    id: "monaco",
    name: "代码编辑器 (Monaco)",
    description: "VS Code 同款 Web 编辑器",
    icon: FileCode,
    sizeMB: 15,
    homepageUrl: "https://microsoft.github.io/monaco-editor/",
  },
  "tower-agent-openclaw": {
    id: "tower-agent-openclaw",
    name: "Tower Agent (OpenClaw)",
    description: "安装 Tower 助手 profile、MCP 与 skills 到 OpenClaw",
    icon: RadioTower,
    sizeMB: 1,
    homepageUrl: "https://docs.openclaw.ai/",
    hintKey: "settings.extensions.towerAgentHint",
  },
  "tower-agent-hermes": {
    id: "tower-agent-hermes",
    name: "Tower Agent (Hermes)",
    description: "安装 Tower 助手 profile、MCP 与 skills 到 Hermes",
    icon: Bot,
    sizeMB: 1,
    homepageUrl: "https://hermes-agent.nousresearch.com/docs/",
    hintKey: "settings.extensions.towerAgentHint",
  },
};

const METADATA_LIST: ReadonlyArray<ExtensionMetadata> = [
  EXTENSION_METADATA.rg,
  EXTENSION_METADATA.monaco,
  EXTENSION_METADATA["tower-agent-openclaw"],
  EXTENSION_METADATA["tower-agent-hermes"],
];

export function listExtensionMetadata(): ReadonlyArray<ExtensionMetadata> {
  return METADATA_LIST;
}

export function getExtensionMetadata(id: ExtensionId): ExtensionMetadata | null {
  return EXTENSION_METADATA[id] ?? null;
}
