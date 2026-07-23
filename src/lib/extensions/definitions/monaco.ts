import { FileCode } from "lucide-react";
import { existsSync, readFileSync, rmSync } from "fs";
import path from "path";
import { getExtensionsDir } from "@/lib/tower-dir";
import { downloadAndExtract } from "../download";
import type { Extension, ExtensionStatus, ExtensionResult } from "../types";

// We pin Monaco to a known-good version. Bumping it is intentional: editor
// behavior, language modes, and worker URLs can shift between releases.
const MONACO_VERSION = "0.55.1";

// Layout after `downloadAndExtract`:
//   ~/.tower/extensions/monaco/
//   ├── package.json
//   ├── min/vs/loader.js   ← served via /api/internal/monaco/[...]
//   └── ...
const MONACO_DIR = path.join(getExtensionsDir(), "monaco");
const MONACO_PKG = path.join(MONACO_DIR, "package.json");
const MONACO_VS_LOADER = path.join(MONACO_DIR, "min", "vs", "loader.js");

async function check(): Promise<ExtensionStatus> {
  if (!existsSync(MONACO_PKG) || !existsSync(MONACO_VS_LOADER)) {
    return { installed: false };
  }

  let version: string | undefined;
  try {
    const parsed = JSON.parse(readFileSync(MONACO_PKG, "utf-8")) as { version?: string };
    version = parsed.version;
  } catch {
    // Best-effort — a malformed package.json doesn't mean Monaco's broken,
    // we still have a loader.js on disk.
  }

  return { installed: true, path: MONACO_DIR, version };
}

async function install(): Promise<ExtensionResult> {
  try {
    await downloadAndExtract("monaco-editor", MONACO_VERSION, MONACO_DIR);
    if (!existsSync(MONACO_VS_LOADER)) {
      return {
        success: false,
        error: `Download succeeded but ${MONACO_VS_LOADER} is missing — the tarball layout may have changed`,
      };
    }
    return { success: true, message: `Installed monaco-editor@${MONACO_VERSION} to ${MONACO_DIR}` };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function uninstall(): Promise<ExtensionResult> {
  try {
    if (existsSync(MONACO_DIR)) {
      rmSync(MONACO_DIR, { recursive: true, force: true });
    }
    return { success: true, message: "Removed monaco-editor" };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export const monacoExtension: Extension = {
  id: "monaco",
  name: "代码编辑器 (Monaco)",
  nameKey: "settings.extensions.monaco.name",
  description: "VS Code 同款 Web 编辑器",
  descriptionKey: "settings.extensions.monaco.description",
  icon: FileCode,
  sizeMB: 15,
  homepageUrl: "https://microsoft.github.io/monaco-editor/",
  check,
  install,
  uninstall,
};
