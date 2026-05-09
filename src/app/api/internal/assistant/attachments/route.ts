import * as path from "node:path";
import * as fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost } from "@/lib/internal-api-guard";
import {
  detectImageMime,
  MIME_TO_EXT,
  isLikelyTextFile,
  TEXT_EXT_TO_MIME,
} from "@/lib/mime-magic";
import {
  getAssistantCacheDir,
  buildCacheFilename,
  getAssistantCacheRoot,
} from "@/lib/file-utils";
import { getConfigValue } from "@/actions/config-actions";
import {
  classifyAttachmentExt,
  ALLOWED_TEXT_EXTS,
  type AttachmentKind,
} from "@/lib/attachment-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/internal/assistant/attachments
 *
 * Single-file uploader for assistant chat attachments. Routes by extension:
 *   - images (jpg/jpeg/png/gif/webp) → cache/assistant/<YYYY-MM>/images/
 *     validated by magic-byte (never trusts file.type)
 *   - text   (md/txt/json/csv)        → cache/assistant/<YYYY-MM>/files/
 *     validated by extension allowlist + null-byte sniff
 *
 * Returns: { filename: subPath, kind, mimeType }
 */
export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 });
  }

  const maxBytes = await getConfigValue<number>("system.maxUploadBytes", 52428800);
  if (file.size > maxBytes) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Step 1: classify by extension before reading content
  const rawExt = path.extname(file.name);
  const kind: AttachmentKind | null = classifyAttachmentExt(rawExt);
  if (!kind) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  let ext: string;
  let mimeType: string;
  let dir: string;

  if (kind === "image") {
    // Magic-byte validation — NEVER trust extension alone for images
    const detected = detectImageMime(buffer);
    if (!detected) {
      return NextResponse.json({ error: "Invalid image content" }, { status: 400 });
    }
    mimeType = detected;
    ext = MIME_TO_EXT[detected];
    dir = getAssistantCacheDir("images");
  } else {
    // Text validation — verify content is non-binary
    if (!isLikelyTextFile(buffer)) {
      return NextResponse.json(
        { error: "File appears to be binary, not text" },
        { status: 400 }
      );
    }
    const lowered = rawExt.toLowerCase();
    if (!(ALLOWED_TEXT_EXTS as readonly string[]).includes(lowered.replace(/^\./, ""))) {
      return NextResponse.json({ error: "Unsupported text type" }, { status: 400 });
    }
    ext = lowered;
    mimeType = TEXT_EXT_TO_MIME[lowered] ?? "text/plain";
    dir = getAssistantCacheDir("files");
  }

  const filename = buildCacheFilename(file.name, ext);
  const dest = path.join(dir, filename);

  // Containment check
  if (!dest.startsWith(dir + path.sep) && dest !== dir) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  await fs.promises.writeFile(dest, buffer);

  // Sub-path is what the client passes back when sending the chat message
  const cachePath = path.relative(getAssistantCacheRoot(), dest);
  return NextResponse.json({ filename: cachePath, mimeType, kind });
}
