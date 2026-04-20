import * as path from "node:path";
import * as fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { detectImageMime, MIME_TO_EXT } from "@/lib/mime-magic";
import { getAssistantCacheDir, buildCacheFilename } from "@/lib/file-utils";
import { getConfigValue } from "@/actions/config-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  // Size check using existing system config
  const maxBytes = await getConfigValue<number>("system.maxUploadBytes", 52428800);
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Magic-byte validation — NOT file.type
  const mimeType = detectImageMime(buffer);
  if (!mimeType) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const ext = MIME_TO_EXT[mimeType];
  const dir = getAssistantCacheDir("images");
  const filename = buildCacheFilename(file.name, ext);
  const dest = path.join(dir, filename);

  // Belt-and-suspenders containment check
  if (!dest.startsWith(dir + path.sep) && dest !== dir) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  await fs.promises.writeFile(dest, buffer);

  // Return sub-path relative to assistant cache root (e.g., "2026-04/images/设计稿-a1b2c3d4.png")
  const assistantRoot = path.join(process.cwd(), "data", "cache", "assistant");
  const cachePath = path.relative(assistantRoot, dest);
  return NextResponse.json({ filename: cachePath, mimeType });
}
