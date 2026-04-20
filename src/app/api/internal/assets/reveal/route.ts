import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFile = promisify(execFileCb);

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bodyPath = body.path;
  if (!bodyPath || typeof bodyPath !== "string") {
    return NextResponse.json(
      { error: "path is required and must be a string" },
      { status: 400 }
    );
  }

  const resolvedPath = path.resolve(process.cwd(), bodyPath);
  const assetsRoot = path.resolve(process.cwd(), "data/assets/");

  // Security: prevent directory traversal outside data/assets/
  if (!resolvedPath.startsWith(assetsRoot + path.sep) && resolvedPath !== assetsRoot) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Verify file exists
  try {
    await fs.promises.stat(resolvedPath);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Platform-specific reveal command
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      await execFile("open", ["-R", resolvedPath]);
    } else if (platform === "linux") {
      await execFile("xdg-open", [path.dirname(resolvedPath)]);
    } else if (platform === "win32") {
      await execFile("explorer", ["/select,", resolvedPath]);
    } else {
      return NextResponse.json(
        { error: "Unsupported platform" },
        { status: 400 }
      );
    }
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to reveal file";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
