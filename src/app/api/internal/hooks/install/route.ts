import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
const HOOK_MARKER = "post-tool-hook.js";

function readSettings(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettings(data: Record<string, unknown>): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

type HookEntry = {
  hooks: { command: string; timeout: number; type: string }[];
  matcher: string;
};

function getPostToolUseArray(settings: Record<string, unknown>): HookEntry[] {
  const hooks = settings["hooks"] as Record<string, unknown> | undefined;
  if (!hooks) return [];
  const postToolUse = hooks["PostToolUse"] as HookEntry[] | undefined;
  return Array.isArray(postToolUse) ? postToolUse : [];
}

function findTowerHookIndex(entries: HookEntry[]): number {
  return entries.findIndex((entry) =>
    entry.hooks?.some((h) => h.command?.includes(HOOK_MARKER))
  );
}

export async function GET(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const settings = readSettings();
  const entries = getPostToolUseArray(settings);
  const idx = findTowerHookIndex(entries);
  const hookPath = path.join(process.cwd(), "scripts", "post-tool-hook.js");

  return NextResponse.json({
    installed: idx >= 0,
    hookPath,
  });
}

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const settings = readSettings();
  const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
  const entries = getPostToolUseArray(settings);

  // Already installed — skip
  if (findTowerHookIndex(entries) >= 0) {
    return NextResponse.json({ success: true, message: "already installed" });
  }

  const hookPath = path.join(process.cwd(), "scripts", "post-tool-hook.js");
  const newEntry: HookEntry = {
    hooks: [
      {
        command: `node "${hookPath}"`,
        timeout: 10,
        type: "command",
      },
    ],
    matcher: "Write|Edit|MultiEdit",
  };

  const updatedEntries = [...entries, newEntry];
  settings["hooks"] = { ...hooks, PostToolUse: updatedEntries };
  writeSettings(settings);

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const settings = readSettings();
  const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
  const entries = getPostToolUseArray(settings);

  const filtered = entries.filter(
    (entry) => !entry.hooks?.some((h) => h.command?.includes(HOOK_MARKER))
  );

  settings["hooks"] = { ...hooks, PostToolUse: filtered };
  writeSettings(settings);

  return NextResponse.json({ success: true });
}
