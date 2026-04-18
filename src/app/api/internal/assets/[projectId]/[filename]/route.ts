import * as fs from "node:fs";
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { resolveAssetPath, MIME_MAP } from "@/lib/file-serve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; filename: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { projectId, filename } = await params;

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
    return NextResponse.json({ error: "Read error" }, { status: 500 });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
