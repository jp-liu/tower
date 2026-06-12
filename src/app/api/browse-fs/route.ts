import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

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
function getWindowsDrives(
  currentPath?: string,
  trace?: string[]
): { name: string; path: string; isGit: boolean }[] {
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
  trace?.push(`probe=${drives.length}`);
  // Secondary probe: if existence checks found nothing (some hardened Windows
  // setups block stat on drive roots), ask the OS directly. `wmic` exists on
  // older Windows; PowerShell's Get-PSDrive covers Win11 where wmic is gone.
  if (drives.length === 0) {
    const shell = enumerateDrivesViaShell();
    trace?.push(`shell=${shell.length}`);
    for (const letter of shell) {
      if (!seen.has(letter)) {
        drives.push({ name: `${letter}:`, path: `${letter}:\\`, isGit: false });
        seen.add(letter);
      }
    }
  }

  // Hard fallback: derive a drive letter from the path we're browsing, then the
  // home directory, then "C:" as a last resort. Guarantees the list is never
  // empty on Windows even if every probe above failed.
  const addLetter = (letter: string | undefined) => {
    if (!letter) return;
    const up = letter.toUpperCase();
    if (!seen.has(up)) {
      drives.unshift({ name: `${up}:`, path: `${up}:\\`, isGit: false });
      seen.add(up);
    }
  };
  if (drives.length === 0) {
    addLetter(/^([A-Za-z]):/.exec(currentPath ?? "")?.[1]);
    addLetter(/^([A-Za-z]):/.exec(os.homedir())?.[1]);
    addLetter("C");
    trace?.push(`fb=ran(cp=${currentPath ?? ""})`);
  } else {
    addLetter(/^([A-Za-z]):/.exec(currentPath ?? "")?.[1]);
    trace?.push("fb=skip");
  }
  trace?.push(`final=${drives.length}`);
  return drives;
}

/** Ask Windows for its filesystem drive letters. Best-effort; returns []. */
function enumerateDrivesViaShell(): string[] {
  const letters = new Set<string>();
  const tryCmd = (cmd: string) => {
    try {
      const out = execSync(cmd, { encoding: "utf-8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
      for (const match of out.matchAll(/([A-Za-z]):/g)) {
        letters.add(match[1].toUpperCase());
      }
    } catch {
      // command unavailable — try the next one
    }
  };
  tryCmd("wmic logicaldisk get caption");
  if (letters.size === 0) {
    // NOTE: spell out ForEach-Object — do NOT use the `%` alias. `%%` is only
    // collapsed to `%` inside .bat/.cmd files; passed straight to execSync the
    // shell hands PowerShell a literal `%%`, which errors, so this fallback
    // silently never worked. -NonInteractive prevents a hang waiting on input.
    tryCmd(
      'powershell -NoProfile -NonInteractive -Command "Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Name + \':\' }"'
    );
  }
  if (letters.size === 0) {
    // Last resort for locked-down machines where the above are blocked.
    tryCmd(
      'powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_LogicalDisk | ForEach-Object { $_.DeviceID }"'
    );
  }
  return [...letters];
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

    const driveTrace: string[] = [];
    const drives = isWin ? getWindowsDrives(resolved, driveTrace) : undefined;
    if (isWin) {
      console.error(
        `[browse-fs] platform=${process.platform} drives=${drives?.length ?? 0} ` +
          `letters=[${(drives ?? []).map((d) => d.name).join(",")}] ` +
          `trace=[${driveTrace.join(" ")}] path=${resolved} home=${os.homedir()}`
      );
    }

    return NextResponse.json({
      currentPath: resolved,
      parentPath: isAtRoot ? "__DRIVES__" : parentPath,
      homePath: os.homedir(),
      folders,
      // isWindows drives the switcher button's visibility on the client (so it
      // shows on Windows regardless of how many drives were detected).
      isWindows: isWin,
      // Surfaced in the client's "no drives" empty state so a single screenshot
      // is self-diagnosing (which platform the server sees, how many drives it
      // detected) — saves round-trips chasing the terminal log. `diag` is a
      // build marker: if a screenshot doesn't show the current marker, the
      // running server is NOT this build (stale publish/install/restart).
      platform: process.platform,
      diag: `drivefix-5 ${driveTrace.join(" ")}`,
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
