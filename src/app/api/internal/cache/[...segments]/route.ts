import * as fs from "node:fs";
import * as path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { MIME_MAP } from "@/lib/file-serve";
import { getAssistantCacheRoot } from "@/lib/file-utils";
import { ATTACHMENT_SUBPATH_RE } from "@/lib/attachment-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Sub-path format: YYYY-MM/(images|files)/filename.ext (image or text whitelist)
// Uses [^/]+ for the filename segment to allow Unicode/Chinese characters
const SUBPATH_RE = ATTACHMENT_SUBPATH_RE;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ segments: string[] }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { segments } = await params;
  // Next.js auto-decodes URL-encoded segments — do NOT call decodeURIComponent
  const subPath = segments.join("/");

  if (!SUBPATH_RE.test(subPath)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const cacheRoot = getAssistantCacheRoot();
  const resolved = path.resolve(cacheRoot, subPath);

  // Containment check — resolved path must be inside cache root
  if (!resolved.startsWith(cacheRoot + path.sep)) {
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

  const ext = path.extname(subPath).toLowerCase();
  const contentType = MIME_MAP[ext] ?? "application/octet-stream";

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
