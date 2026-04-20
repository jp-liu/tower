import * as fs from "node:fs";
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { resolveAssetPath, MIME_MAP } from "@/lib/file-serve";
import { validateProjectId } from "@/lib/internal-api-guard";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; filename: string }> }
) {
  const { projectId, filename } = await params;

  const invalidProjectId = validateProjectId(projectId);
  if (invalidProjectId) return invalidProjectId;

  const { resolved, error } = resolveAssetPath(projectId, filename);
  if (error || !resolved) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(resolved);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}
