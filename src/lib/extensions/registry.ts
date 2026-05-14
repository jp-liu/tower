import type { Extension, ExtensionId } from "./types";
import { ripgrepExtension } from "./definitions/ripgrep";
import { monacoExtension } from "./definitions/monaco";

const EXTENSIONS: ReadonlyArray<Extension> = [
  ripgrepExtension,
  monacoExtension,
] as const;

export function listExtensions(): ReadonlyArray<Extension> {
  return EXTENSIONS;
}

export function getExtension(id: ExtensionId): Extension | null {
  return EXTENSIONS.find((e) => e.id === id) ?? null;
}
