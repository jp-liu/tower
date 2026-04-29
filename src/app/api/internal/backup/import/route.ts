import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { join } from "node:path";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { getBackupsDir } from "@/lib/tower-dir";
import { validateFilename, readMetadataFromArchive } from "@/lib/backup";
import { getConfigValue } from "@/actions/config-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate filename pattern
    try {
      validateFilename(file.name);
    } catch {
      return NextResponse.json({ error: "Invalid backup filename" }, { status: 400 });
    }

    // Resolve backup dir
    const custom = await getConfigValue("system.backupDir", "");
    const backupsDir = custom || getBackupsDir();
    mkdirSync(backupsDir, { recursive: true });

    const destPath = join(backupsDir, file.name);
    if (existsSync(destPath)) {
      return NextResponse.json({ error: "File already exists" }, { status: 409 });
    }

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    writeFileSync(destPath, buffer);

    // Validate it's a real backup with metadata
    const meta = await readMetadataFromArchive(destPath);
    if (!meta || !meta.version) {
      // Clean up invalid file
      try { require("node:fs").unlinkSync(destPath); } catch { /* ignore */ }
      return NextResponse.json({ error: "Invalid backup archive" }, { status: 400 });
    }

    return NextResponse.json({ filename: file.name, metadata: meta });
  } catch {
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
