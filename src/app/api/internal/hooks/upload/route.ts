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

const CUID_RE = /^c[a-z0-9]{20,30}$/;

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

  // Look up task to get projectId
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { projectId: true },
  });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const projectId = task.projectId;

  // Ensure target directory exists
  const assetsDir = ensureAssetsDir(projectId);

  // Handle filename collision
  let filename = path.basename(filePath);
  let destPath = path.join(assetsDir, filename);

  if (existsSync(destPath)) {
    const stem = path.basename(filename, path.extname(filename));
    const timestamp = Date.now();
    filename = `${stem}-${timestamp}.${ext}`;
    destPath = path.join(assetsDir, filename);
  }

  // Copy file
  try {
    await copyFile(filePath, destPath);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to copy file: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 500 }
    );
  }

  // Create DB record
  const mimeType = MIME_MAP[ext] || "application/octet-stream";
  const asset = await db.projectAsset.create({
    data: {
      filename,
      path: destPath,
      mimeType,
      size: fileStat.size,
      projectId,
      taskId,
    },
  });

  return NextResponse.json({ success: true, assetId: asset.id });
}
