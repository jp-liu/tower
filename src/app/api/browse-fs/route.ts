import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

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
function getWindowsDrives(): { name: string; path: string; isGit: boolean }[] {
  const drives: { name: string; path: string; isGit: boolean }[] = [];
  // Check drive letters A-Z
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const drivePath = `${letter}:\\`;
    try {
      fs.accessSync(drivePath, fs.constants.R_OK);
      drives.push({ name: `${letter}:`, path: drivePath, isGit: false });
    } catch {
      // Drive does not exist or is not accessible
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

    return NextResponse.json({
      currentPath: resolved,
      parentPath: isAtRoot ? "__DRIVES__" : parentPath,
      homePath: os.homedir(),
      folders,
      // Include drive list on Windows for cross-drive navigation
      ...(isWin ? { drives: getWindowsDrives() } : {}),
    });
  } catch {
    return NextResponse.json(
      { error: "Cannot read directory", currentPath: dirPath },
      { status: 400 }
    );
  }
}
