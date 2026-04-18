import * as fs from "node:fs";
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { MIME_MAP } from "@/lib/file-serve";
import { getAssistantCacheDir } from "@/lib/file-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// UUID v4 + allowed image extensions — prevents traversal and arbitrary filenames
const FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { filename } = await params;
  if (!FILENAME_RE.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const dir = getAssistantCacheDir();
  const resolved = path.resolve(dir, filename);
  // Containment check — resolved path must be inside cache dir
  if (!resolved.startsWith(dir + path.sep)) {
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
