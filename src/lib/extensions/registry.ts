import type { Extension, ExtensionId } from "./types";
import { ripgrepExtension } from "./definitions/ripgrep";
import { monacoExtension } from "./definitions/monaco";
import { towerAgentOpenClawExtension } from "./definitions/tower-agent-openclaw";
import { towerAgentHermesExtension } from "./definitions/tower-agent-hermes";

const EXTENSIONS: ReadonlyArray<Extension> = [
  ripgrepExtension,
  monacoExtension,
  towerAgentOpenClawExtension,
  towerAgentHermesExtension,
] as const;

export function listExtensions(): ReadonlyArray<Extension> {
  return EXTENSIONS;
}

export function getExtension(id: ExtensionId): Extension | null {
  return EXTENSIONS.find((e) => e.id === id) ?? null;
}
