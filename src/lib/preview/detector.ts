import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { PRESETS } from "./presets";
import type { PreviewPreset, DetectContext } from "./preset-types";

const MARKER_FILES = [
  "package.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "manage.py",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "index.html",
] as const;

export async function readPresetFiles(
  cwd: string
): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    MARKER_FILES.map(async (name) => {
      try {
        const content = await readFile(join(cwd, name), "utf-8");
        return [name, content] as const;
      } catch {
        return [name, null] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

async function makeContext(cwd: string): Promise<DetectContext> {
  const files = await readPresetFiles(cwd);
  return {
    files,
    // V1 presets 不使用 hasDir（只用 files map）。未来如有 preset 用到，
    // 这里改成同步 existsSync(join(cwd, rel)) 即可。
    hasDir: () => false,
  };
}

export async function detectPreset(
  cwd: string
): Promise<PreviewPreset | null> {
  try {
    await access(cwd, constants.R_OK);
  } catch {
    return null;
  }
  const ctx = await makeContext(cwd);
  for (const preset of PRESETS) {
    try {
      if (preset.detect(ctx)) return preset;
    } catch {
      // 单个 preset detect 抛错不影响其他
    }
  }
  return null;
}
