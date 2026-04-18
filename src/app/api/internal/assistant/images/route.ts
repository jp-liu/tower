import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import { detectImageMime, MIME_TO_EXT } from "@/lib/mime-magic";
import { ensureAssistantCacheDir } from "@/lib/file-utils";
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
  const filename = `${crypto.randomUUID()}${ext}`;

  const dir = ensureAssistantCacheDir();
  const dest = path.join(dir, filename);
  // Belt-and-suspenders containment check (UUID prevents traversal but verify anyway)
  if (!dest.startsWith(dir + path.sep) && dest !== dir) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  await fs.promises.writeFile(dest, buffer);
  return NextResponse.json({ filename, mimeType });
}
