import * as fs from "node:fs";
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { resolveAssetPath, MIME_MAP } from "@/lib/file-serve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CUID_RE = /^c[a-z0-9]{20,30}$/;
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_\-\.]{1,128}\.(png|jpg|jpeg|gif|webp|pdf|txt|md|json|svg)$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; filename: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { projectId, filename } = await params;

  if (!CUID_RE.test(projectId) || !SAFE_FILENAME_RE.test(filename)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

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
