/**
 * Client-safe extension metadata. Imports lucide-react icons only — no Node
 * modules. Consumed by client components (ExtensionsSection, ExtensionCard,
 * WizardStepExtensions, ExtensionContext).
 *
 * The full Extension definitions (with check/install/uninstall) live in
 * `definitions/{ripgrep,monaco}.ts` and are server-only. The registry
 * (server-side) re-exports those; this file is the client-side counterpart.
 */
import { Search, FileCode } from "lucide-react";
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
};

const METADATA_LIST: ReadonlyArray<ExtensionMetadata> = [
  EXTENSION_METADATA.rg,
  EXTENSION_METADATA.monaco,
];

export function listExtensionMetadata(): ReadonlyArray<ExtensionMetadata> {
  return METADATA_LIST;
}

export function getExtensionMetadata(id: ExtensionId): ExtensionMetadata | null {
  return EXTENSION_METADATA[id] ?? null;
}
