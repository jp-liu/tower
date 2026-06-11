import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dangerous system directories that should not be browsed
const BLOCKED_PATHS_UNIX = ["/proc", "/sys", "/dev", "/boot", "/sbin"];
const BLOCKED_PATHS_WIN = ["C:\\Windows", "C:\\$Recycle.Bin"];

function isBlockedPath(resolved: string): boolean {
  const isWin = process.platform === "win32";
  const blocked = isWin ? BLOCKED_PATHS_WIN : BLOCKED_PATHS_UNIX;
  const normalized = isWin ? resolved.toLowerCase() : resolved;
  return blocked.some((b) => normalized.startsWith(isWin ? b.toLowerCase() : b));
}

/**
 * On Windows, return drive letters (C:\, D:\, etc.) as top-level navigation.
 * This allows users to switch between drives in the folder browser.
 */
function getWindowsDrives(currentPath?: string): { name: string; path: string; isGit: boolean }[] {
  const drives: { name: string; path: string; isGit: boolean }[] = [];
  const seen = new Set<string>();
  // Probe drive letters A-Z. Use existsSync (existence) rather than
  // accessSync(R_OK): on some Windows setups the readability check throws for a
  // perfectly browsable drive root, which left the drive list empty and hid the
  // switcher button entirely.
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const drivePath = `${letter}:\\`;
    try {
      if (fs.existsSync(drivePath)) {
        drives.push({ name: `${letter}:`, path: drivePath, isGit: false });
        seen.add(letter);
      }
    } catch {
      // Drive does not exist or is not accessible
    }
  }
  // Fallback: always include the drive of the path we're currently browsing, so
  // the switcher is never empty even if probing missed it.
  const m = /^([A-Za-z]):/.exec(currentPath ?? "");
  if (m) {
    const letter = m[1].toUpperCase();
    if (!seen.has(letter)) {
      drives.unshift({ name: `${letter}:`, path: `${letter}:\\`, isGit: false });
    }
  }
  return drives;
}

export async function GET(request: NextRequest) {
  const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();

  try {
    const resolved = path.resolve(dirPath);

    // Block dangerous system directories
    if (isBlockedPath(resolved)) {
      return NextResponse.json({ error: "Access denied: system directory" }, { status: 403 });
    }

    // Check directory exists
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    // List entries
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => {
        const fullPath = path.join(resolved, e.name);
        const isGit = fs.existsSync(path.join(fullPath, ".git"));
        return {
          name: e.name,
          path: fullPath,
          isGit,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // On Windows, when at a drive root (e.g. C:\), parentPath should show drive list
    const isWin = process.platform === "win32";
    const parentPath = path.dirname(resolved);
    const isAtRoot = isWin
      ? resolved === parentPath // drive root: C:\ → dirname is C:\
      : resolved === "/";

    const drives = isWin ? getWindowsDrives(resolved) : undefined;
    if (isWin) {
      console.error(`[browse-fs] win=true drives=${drives?.length ?? 0} path=${resolved}`);
    }

    return NextResponse.json({
      currentPath: resolved,
      parentPath: isAtRoot ? "__DRIVES__" : parentPath,
      homePath: os.homedir(),
      folders,
      // isWindows drives the switcher button's visibility on the client (so it
      // shows on Windows regardless of how many drives were detected).
      isWindows: isWin,
      // Include drive list on Windows for cross-drive navigation
      ...(isWin ? { drives } : {}),
    });
  } catch {
    return NextResponse.json(
      { error: "Cannot read directory", currentPath: dirPath },
      { status: 400 }
    );
  }
}

/** Create a new folder inside a given directory. */
export async function POST(request: NextRequest) {
  try {
    const { parentPath, name } = await request.json();
    if (!parentPath || !name) {
      return NextResponse.json({ error: "parentPath and name are required" }, { status: 400 });
    }

    // Sanitize: no path separators, no traversal
    const sanitized = name.replace(/[/\\]/g, "").trim();
    if (!sanitized || sanitized === "." || sanitized === "..") {
      return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
    }

    const resolved = path.resolve(parentPath, sanitized);

    if (isBlockedPath(resolved)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (fs.existsSync(resolved)) {
      return NextResponse.json({ error: "Folder already exists" }, { status: 409 });
    }

    fs.mkdirSync(resolved, { recursive: true });

    return NextResponse.json({ path: resolved });
  } catch {
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }
}
