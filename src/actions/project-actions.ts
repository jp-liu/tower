"use server";

import { rename, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

/**
 * Pre-flight safety check for project migration.
 * Returns { safe: true } if migration is allowed,
 * or { safe: false, reason: string } explaining why not.
 */
export async function checkMigrationSafety(
  projectId: string
): Promise<{ safe: true } | { safe: false; reason: string }> {
  if (!projectId || typeof projectId !== "string") {
    return { safe: false, reason: "无效的项目 ID" };
  }

  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project || !project.localPath) {
    return { safe: false, reason: "项目不存在或未设置本地路径" };
  }

  // Check running executions
  const runningExecutions = await db.taskExecution.findMany({
    where: { task: { projectId }, status: "RUNNING" },
    select: { id: true },
  });
  if (runningExecutions.length > 0) {
    return { safe: false, reason: "该项目有正在运行的任务执行，请先停止所有执行" };
  }

  // Check active PTY sessions
  const tasks = await db.task.findMany({
    where: { projectId },
    select: { id: true },
  });
  const { getSession } = await import("@/lib/pty/session-store");
  for (const task of tasks) {
    if (getSession(task.id) !== undefined) {
      return { safe: false, reason: "该项目有活跃的终端会话，请先关闭" };
    }
  }

  // Check existing worktrees
  const worktreesDir = path.join(project.localPath, ".worktrees");
  if (existsSync(worktreesDir)) {
    try {
      const entries = await readdir(worktreesDir);
      if (entries.length > 0) {
        return { safe: false, reason: "该项目有活跃的 Git Worktree，请先清理" };
      }
    } catch {
      // If we can't read, assume no worktrees
    }
  }

  return { safe: true };
}

/**
 * Atomically migrate a project directory to a new path.
 * Uses fs.rename (same-filesystem only, EXDEV = hard error).
 */
export async function migrateProjectPath(
  projectId: string,
  targetPath: string
): Promise<{ success: true } | { success: false; error: string }> {
  // Validate inputs
  if (!projectId || typeof projectId !== "string") {
    return { success: false, error: "无效的项目 ID" };
  }
  if (!targetPath || typeof targetPath !== "string" || !path.isAbsolute(targetPath)) {
    return { success: false, error: "目标路径必须是非空的绝对路径" };
  }

  // Load project
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project || !project.localPath) {
    return { success: false, error: "项目不存在或未设置本地路径" };
  }

  const sourcePath = project.localPath;

  // Pre-flight: same path check
  if (targetPath === sourcePath) {
    return { success: false, error: "源路径和目标路径相同" };
  }

  // Pre-flight: running executions
  const runningExecutions = await db.taskExecution.findMany({
    where: { task: { projectId }, status: "RUNNING" },
    select: { id: true },
  });
  if (runningExecutions.length > 0) {
    return { success: false, error: "该项目有正在运行的任务执行，请先停止所有执行" };
  }

  // Pre-flight: active PTY sessions
  const tasks = await db.task.findMany({
    where: { projectId },
    select: { id: true },
  });
  const { getSession } = await import("@/lib/pty/session-store");
  for (const task of tasks) {
    if (getSession(task.id) !== undefined) {
      return { success: false, error: "该项目有活跃的终端会话，请先关闭" };
    }
  }

  // Pre-flight: existing worktrees
  const worktreesDir = path.join(sourcePath, ".worktrees");
  if (existsSync(worktreesDir)) {
    try {
      const entries = await readdir(worktreesDir);
      if (entries.length > 0) {
        return { success: false, error: "该项目有活跃的 Git Worktree，请先清理" };
      }
    } catch {
      // If we can't read, assume no worktrees
    }
  }

  // Pre-flight: target path
  if (existsSync(targetPath)) {
    try {
      const entries = await readdir(targetPath);
      if (entries.length > 0) {
        return { success: false, error: "目标路径已存在且不为空" };
      }
    } catch {
      return { success: false, error: "目标路径已存在且不为空" };
    }
  }

  // Create parent directory
  await mkdir(path.dirname(targetPath), { recursive: true });

  // Atomic rename
  try {
    await rename(sourcePath, targetPath);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "EXDEV") {
      return { success: false, error: "源路径和目标路径不在同一文件系统，不支持跨设备迁移" };
    }
    return { success: false, error: error.message || "文件系统操作失败" };
  }

  // Update database
  await db.project.update({
    where: { id: projectId },
    data: { localPath: targetPath },
  });

  // Revalidate
  revalidatePath("/workspaces");

  return { success: true };
}

/**
 * Analyze a project directory using Claude CLI one-shot and return a structured
 * Markdown description of the project's tech stack, module structure, and entry points.
 *
 * @param localPath - Absolute path to the project directory (no tilde aliases)
 * @returns Trimmed Markdown string from Claude CLI output
 * @throws Error if path is invalid or CLI invocation fails
 */
export async function analyzeProjectDirectory(localPath: string): Promise<string> {
  if (!localPath || typeof localPath !== "string") {
    throw new Error("无效的本地路径");
  }
  if (localPath.startsWith("~")) {
    throw new Error("不支持 ~ 别名，请提供绝对路径");
  }
  if (!path.isAbsolute(localPath)) {
    throw new Error("本地路径必须为绝对路径");
  }

  const prompt = `You are analyzing a software project directory. Read the directory structure and key files (package.json, README.md, src/ or lib/ directory layout, any monorepo config like pnpm-workspace.yaml, lerna.json, or turbo.json) to generate a structured project description.

Output ONLY the Markdown description with these sections (omit sections with no data):

## 技术栈
List the primary languages, frameworks, and key libraries.

## 模块结构
Briefly describe the main packages/modules and their responsibilities.

## 入口点
Key entry files (e.g. src/index.ts, apps/web/src/app/page.tsx).

## MCP subPath（如果是 monorepo）
If this is a monorepo, list each package/app with its relative path and one-line purpose.

Keep the description concise (under 400 words). Do not add commentary or preamble — output only the Markdown.`;

  const { aiQuery } = await import("@/lib/claude-session");
  const result = await aiQuery(prompt, localPath, {
    maxTurns: 3,
    tools: ["Read", "Glob"],
    allowedTools: ["Read", "Glob"],
  });
  if (!result) throw new Error("AI 分析未返回结果");
  return result;
}
