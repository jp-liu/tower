export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { stat, copyFile } from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import { db } from "@/lib/db";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { readConfigValue } from "@/lib/config-reader";
import { ensureAssetsDir } from "@/lib/file-utils";
import { deriveSourceKey, hashFile, buildAssetFilename } from "@/lib/asset-dedup";

/** Prisma unique-constraint violation (lost concurrent insert race). */
function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

const DEFAULT_UPLOAD_TYPES = [
  "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "md", "txt", "json",
];

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
};

/**
 * GET /api/internal/hooks/upload
 * Returns the configured auto-upload type whitelist.
 */
export async function GET(request: NextRequest) {
  const forbidden = requireLocalhost(request);
  if (forbidden) return forbidden;

  const types = await readConfigValue<string[]>(
    "hooks.autoUploadTypes",
    DEFAULT_UPLOAD_TYPES
  );

  return NextResponse.json({ types });
}

/**
 * POST /api/internal/hooks/upload
 * Accepts { taskId, filePath } from the PostToolUse hook script.
 * Copies file to project assets directory and creates a DB record.
 */
export async function POST(request: NextRequest) {
  const forbidden = requireLocalhost(request);
  if (forbidden) return forbidden;

  let body: { taskId?: string; filePath?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { taskId, filePath } = body;

  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
  }

  const taskIdError = validateTaskId(taskId);
  if (taskIdError) return taskIdError;

  if (!filePath || typeof filePath !== "string") {
    return NextResponse.json({ error: "Missing filePath" }, { status: 400 });
  }

  // Validate file exists
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Check file size
  const maxBytes = await readConfigValue<number>("system.maxUploadBytes", 10 * 1024 * 1024);
  if (fileStat.size > maxBytes) {
    return NextResponse.json(
      { error: `File exceeds max size (${maxBytes} bytes)` },
      { status: 413 }
    );
  }

  // Check file extension against whitelist
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const allowedTypes = await readConfigValue<string[]>(
    "hooks.autoUploadTypes",
    DEFAULT_UPLOAD_TYPES
  );
  if (!allowedTypes.includes(ext)) {
    return NextResponse.json(
      { error: `File type .${ext} not in allowed list` },
      { status: 400 }
    );
  }

  // Look up task to get projectId and project localPath for path containment check
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      projectId: true,
      project: { select: { localPath: true } },
    },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // SECURITY: Restrict filePath to within the project directory (or /tmp)
  // Prevents arbitrary file read from any path on the filesystem
  const resolvedFile = path.resolve(filePath);
  const projectRoot = task.project.localPath;
  const tmpDir = process.env.TMPDIR || "/tmp";
  const isUnderProject = projectRoot && resolvedFile.startsWith(path.resolve(projectRoot) + path.sep);
  const isUnderTmp = resolvedFile.startsWith(path.resolve(tmpDir) + path.sep);
  if (!isUnderProject && !isUnderTmp) {
    return NextResponse.json(
      { error: "filePath must be within the project directory or temp directory" },
      { status: 403 }
    );
  }

  const projectId = task.projectId;

  // Ensure target directory exists
  const assetsDir = ensureAssetsDir(projectId);

  // Stable identity + content hash for idempotent dedup. The PostToolUse hook
  // fires on every Write/Edit, so the same file is uploaded many times during a
  // task. Keying by (projectId, sourceKey) collapses those onto ONE asset
  // instead of accumulating `<name>-<Date.now()>.<ext>` copies.
  const sourceKey = deriveSourceKey(resolvedFile, projectRoot);
  const contentHash = hashFile(resolvedFile);
  const mimeType = MIME_MAP[ext] || "application/octet-stream";

  // Re-upload of a file we already captured → update in place (or skip).
  const existing = await db.projectAsset.findUnique({
    where: { projectId_sourceKey: { projectId, sourceKey } },
  });

  if (existing) {
    if (existing.contentHash === contentHash) {
      // Identical content already on record → idempotent no-op.
      return NextResponse.json({
        success: true,
        assetId: existing.id,
        deduped: true,
      });
    }
    // Content changed → overwrite the same on-disk file, keep one record.
    try {
      await copyFile(resolvedFile, existing.path);
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to copy file: ${err instanceof Error ? err.message : "unknown"}` },
        { status: 500 }
      );
    }
    const updated = await db.projectAsset.update({
      where: { id: existing.id },
      data: { contentHash, size: fileStat.size, mimeType, taskId },
    });
    return NextResponse.json({
      success: true,
      assetId: updated.id,
      updated: true,
    });
  }

  // First time we see this source file. Use the basename as-is; only when a
  // DIFFERENT file already occupies that name do we disambiguate — with a
  // deterministic sourceKey hash, never a timestamp.
  let filename = path.posix.basename(sourceKey);
  let destPath = path.join(assetsDir, filename);
  if (existsSync(destPath)) {
    filename = buildAssetFilename(sourceKey, ext, true);
    destPath = path.join(assetsDir, filename);
  }

  // Copy file
  try {
    await copyFile(resolvedFile, destPath);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to copy file: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }

  // Create DB record
  try {
    const asset = await db.projectAsset.create({
      data: {
        filename,
        path: destPath,
        mimeType,
        size: fileStat.size,
        projectId,
        taskId,
        sourceKey,
        contentHash,
      },
    });
    return NextResponse.json({ success: true, assetId: asset.id });
  } catch (err) {
    // Lost a concurrent race on the (projectId, sourceKey) unique key — the
    // winning request already created the record; update it in place instead
    // of surfacing a 500 or creating a duplicate.
    if (isUniqueConstraintError(err)) {
      const winner = await db.projectAsset.findUnique({
        where: { projectId_sourceKey: { projectId, sourceKey } },
      });
      if (winner) {
        await copyFile(resolvedFile, winner.path).catch(() => {});
        const updated = await db.projectAsset.update({
          where: { id: winner.id },
          data: { contentHash, size: fileStat.size, mimeType, taskId },
        });
        return NextResponse.json({
          success: true,
          assetId: updated.id,
          updated: true,
        });
      }
    }
    throw err;
  }
}
