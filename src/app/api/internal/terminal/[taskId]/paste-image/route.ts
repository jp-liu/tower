import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { ensureCacheDir, buildCacheFilename } from "@/lib/file-utils";
import { imageExtForMime } from "@/lib/pty/paste-image";

// Prevent response caching
export const dynamic = "force-dynamic";
// Require Node.js runtime — writes to the host filesystem
export const runtime = "nodejs";

/** 20MB binary cap. base64 inflates ~4/3, so bound the encoded string accordingly. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024;

const bodySchema = z.object({
  mime: z.string().min(1).max(100),
  // base64 payload WITHOUT the "data:...;base64," prefix.
  base64: z.string().min(1).max(MAX_BASE64_CHARS),
  // Original filename (best-effort) — only the stem is used for a readable name.
  name: z.string().max(255).optional(),
});

/**
 * Persist a clipboard image pasted into a task's xterm.js terminal to a host file
 * and return its absolute path. The frontend injects that path as terminal input
 * so the Claude CLI can read the image — xterm itself cannot forward image blobs.
 *
 * Localhost-only (browser → same-origin Next app). The image lands under the
 * per-task cache dir inside the Tower data root.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const { taskId } = await params;

  const invalid = validateTaskId(taskId);
  if (invalid) return invalid;

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { mime, base64, name } = parsed.data;

  const ext = imageExtForMime(mime);
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported image type: ${mime}` },
      { status: 400 }
    );
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    return NextResponse.json({ error: "Invalid base64 payload" }, { status: 400 });
  }

  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "Image is empty or exceeds the 20MB limit" },
      { status: 400 }
    );
  }

  try {
    const dir = ensureCacheDir(taskId);
    const filename = buildCacheFilename(name || "pasted-image", ext);
    const filePath = path.join(dir, filename);
    await fs.promises.writeFile(filePath, buf, { mode: 0o600 });
    return NextResponse.json({ ok: true, path: filePath });
  } catch (e) {
    console.error(
      `[terminal-paste-image] task=${taskId} write failed: ${e instanceof Error ? e.message : e}`
    );
    return NextResponse.json({ error: "Failed to store image" }, { status: 500 });
  }
}
