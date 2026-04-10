import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export async function GET(request: NextRequest) {
  const dirPath = request.nextUrl.searchParams.get("path") || os.homedir();

  try {
    // Resolve to absolute path — restrict to user's home directory
    const resolved = path.resolve(dirPath);
    const home = os.homedir();
    if (!resolved.startsWith(home)) {
      return NextResponse.json({ error: "Access denied: path must be within home directory" }, { status: 403 });
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

    return NextResponse.json({
      currentPath: resolved,
      parentPath: path.dirname(resolved),
      homePath: os.homedir(),
      folders,
    });
  } catch {
    return NextResponse.json(
      { error: "Cannot read directory", currentPath: dirPath },
      { status: 400 }
    );
  }
}
