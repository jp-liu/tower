import { z } from "zod";
import { execFileSync } from "child_process";
import { copyFileSync, existsSync, statSync } from "fs";
import { basename, extname, join } from "path";
import { db } from "../db";
import { readConfigValue } from "@/lib/config-reader";
import { stripCacheUuidSuffix, isAssistantCachePath, guessMimeType, ensureAssetsDir } from "@/lib/file-utils";

const TaskStatus = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]);
const Priority = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const taskTools = {
  list_tasks: {
    description: "List all tasks in a project, optionally filtered by status. Includes labels and is ordered by position then creation date.",
    schema: z.object({
      projectId: z.string(),
      status: TaskStatus.optional(),
    }),
    handler: async (args: { projectId: string; status?: string }) => {
      const tasks = await db.task.findMany({
        where: {
          projectId: args.projectId,
          ...(args.status ? { status: args.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED" } : {}),
          // Exclude system tasks tagged with the builtin "Tower" label
          NOT: { labels: { some: { label: { name: "Tower", isBuiltin: true } } } },
        },
        include: {
          labels: { include: { label: true } },
        },
        orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      });

      return tasks.map((task) => ({
        ...task,
        labels: task.labels.map((tl) => tl.label),
      }));
    },
  },

  create_task: {
    description:
      "Create a new task in a project. Priority defaults to MEDIUM, status defaults to TODO. " +
      "useWorktree (branch isolation) and autoStart (run immediately after create) default to the user's saved preference; " +
      "pass either explicitly to override for this one task. " +
      "If the defaults have never been set, the FIRST call (without explicit useWorktree/autoStart) returns { needsDefaultsSetup: true } instead of creating the task — ask the user their preference, call set_task_defaults once, then call create_task again. " +
      "Pass versionId to file the task under a project version (use list_versions to discover options). " +
      "Pass references as file paths to attach as project assets.",
    schema: z.object({
      projectId: z.string(),
      title: z.string(),
      description: z.string().optional(),
      priority: Priority.optional().default("MEDIUM"),
      status: TaskStatus.optional().default("TODO"),
      labelIds: z.array(z.string()).optional(),
      subPath: z.string().optional(),
      versionId: z.string().optional().describe("Version to assign the task to. Use list_versions to find valid IDs for the project. Omit for backlog (no version)."),
      useWorktree: z.boolean().optional().describe("Use a Git worktree for branch isolation. Omit to use the user's saved default; pass explicitly to override this task."),
      baseBranch: z.string().optional().describe("Base branch for worktree checkout. Only used when useWorktree resolves to true. If omitted, auto-detects the project's current branch."),
      autoStart: z.boolean().optional().describe("Start execution immediately after creating. Omit to use the user's saved default; pass explicitly to override this task."),
      references: z.array(z.string()).max(20).optional(),
    }),
    handler: async (args: {
      projectId: string;
      title: string;
      description?: string;
      priority?: string;
      status?: string;
      labelIds?: string[];
      subPath?: string;
      versionId?: string;
      useWorktree?: boolean;
      baseBranch?: string;
      autoStart?: boolean;
      references?: string[];
    }) => {
      // Resolve worktree / auto-start: explicit arg wins, else fall back to the
      // user's saved global default. On the very first MCP create_task where
      // neither default has been confirmed AND the caller didn't specify, ask
      // the calling AI to collect the user's preference (MCP can't prompt the
      // human directly), save it via set_task_defaults, then retry.
      const explicitWorktree = args.useWorktree !== undefined;
      const explicitAutoStart = args.autoStart !== undefined;
      const defaultsConfigured = await readConfigValue<boolean>("task.mcpDefaultsConfigured", false);
      if (!defaultsConfigured && !explicitWorktree && !explicitAutoStart) {
        return {
          needsDefaultsSetup: true,
          task: null,
          message:
            "首次通过 MCP 创建任务，尚未设置默认偏好。请向用户确认两个选择：" +
            "(1) 以后新建任务是否默认使用 Git worktree 隔离？" +
            "(2) 是否默认创建后自动启动执行？" +
            "拿到选择后调用 set_task_defaults({ useWorktree, autoStart }) 保存（只需一次，以后不再询问），然后重新调用 create_task。" +
            "若某个任务需要特殊处理，可在 create_task 里直接显式传 useWorktree / autoStart 覆盖默认。",
        };
      }
      const useWorktree = explicitWorktree
        ? (args.useWorktree as boolean)
        : await readConfigValue<boolean>("task.defaultUseWorktree", true);
      const autoStart = explicitAutoStart
        ? (args.autoStart as boolean)
        : await readConfigValue<boolean>("task.defaultAutoStart", false);

      // Validate versionId belongs to the project (ignore mismatches → backlog)
      let versionId: string | null = null;
      if (args.versionId) {
        const v = await db.version.findFirst({
          where: { id: args.versionId, projectId: args.projectId },
          select: { id: true },
        });
        versionId = v?.id ?? null;
      }

      // Determine baseBranch: explicit param > auto-detect from project's current git branch
      let baseBranch: string | null = null;
      if (useWorktree) {
        if (args.baseBranch) {
          baseBranch = args.baseBranch;
        } else {
          const project = await db.project.findUnique({ where: { id: args.projectId }, select: { localPath: true } });
          if (project?.localPath) {
            try {
              baseBranch = execFileSync("git", ["branch", "--show-current"], {
                cwd: project.localPath, encoding: "utf-8", timeout: 5000,
              }).trim() || null;
            } catch {
              // fallback: no baseBranch, task runs in direct mode
            }
          }
        }
      }

      // 派生关系：若本次 create_task 由某个 Tower 任务终端发起，MCP 子进程会继承父任务
      // 注入的 TOWER_TASK_ID（已实测可达）→ 自动绑定 parentTaskId（结构化父子关系，
      // 完成回推用）。
      //
      // 注意：description 的「## 来源」文案【完全交给 tower skill】（skills/tower/SKILL.md
      // 有完整规范：飞书 <task-source> 解析、渠道、群链接、溯源 ID 等）。handler 绝不自己
      // 写 ## 来源，避免与 skill 的来源记录重复、覆盖飞书的详细信息。
      const envParentTaskId = process.env.TOWER_TASK_ID || null;
      let resolvedParentId: string | null = null;
      if (envParentTaskId) {
        const parent = await db.task.findUnique({
          where: { id: envParentTaskId },
          select: { id: true },
        });
        if (parent) resolvedParentId = envParentTaskId;
      }

      const task = await db.task.create({
        data: {
          title: args.title,
          description: args.description,
          projectId: args.projectId,
          priority: (args.priority ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
          status: (args.status ?? "TODO") as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED",
          baseBranch,
          versionId,
          subPath: args.subPath ?? null,
          parentTaskId: resolvedParentId,
        },
      });

      if (args.labelIds && args.labelIds.length > 0) {
        await db.taskLabel.createMany({
          data: args.labelIds.map((labelId) => ({ taskId: task.id, labelId })),
        });
      }

      // Copy reference files to assets and create ProjectAsset records.
      // The assets dir is resolved via ensureAssetsDir → getStorageDir(), which
      // honours the user's custom storage location (Settings) and always lands
      // inside the Tower data dir (~/.tower/storage/assets). Never derive it
      // from cwd/__dirname — a global install would point at the read-only
      // install directory (e.g. /usr/local/lib/.../data/assets).
      const attachedFiles: string[] = [];
      const attachmentFailures: { reference: string; error: string }[] = [];
      let updatedDesc: string | null = null;
      if (args.references && args.references.length > 0) {
        let assetsDir: string | null = null;
        try {
          assetsDir = ensureAssetsDir(args.projectId);
        } catch (e) {
          // Storage root unwritable/unresolvable — surface it instead of
          // silently dropping every attachment.
          const error = e instanceof Error ? e.message : String(e);
          for (const filePath of args.references) {
            attachmentFailures.push({ reference: filePath, error });
          }
        }

        if (assetsDir) {
          const dir = assetsDir; // narrowed to string for the loop body
          for (const filePath of args.references) {
            try {
              if (!existsSync(filePath)) {
                attachmentFailures.push({ reference: filePath, error: "源文件不存在" });
                continue;
              }
              const stat = statSync(filePath);
              if (!stat.isFile()) {
                attachmentFailures.push({ reference: filePath, error: "不是文件" });
                continue;
              }

              const isCache = isAssistantCachePath(filePath);
              let filename = isCache
                ? stripCacheUuidSuffix(basename(filePath))
                : basename(filePath);
              // Avoid overwriting existing assets
              if (existsSync(join(dir, filename))) {
                const ext = extname(filename);
                const base = basename(filename, ext);
                if (isCache) {
                  // Use counter suffix for readable cache asset names: "设计稿 (1).png"
                  let counter = 1;
                  while (existsSync(join(dir, `${base} (${counter})${ext}`))) {
                    counter++;
                  }
                  filename = `${base} (${counter})${ext}`;
                } else {
                  filename = `${base}-${Date.now()}${ext}`;
                }
              }
              const dest = join(dir, filename);
              copyFileSync(filePath, dest);

              await db.projectAsset.create({
                data: {
                  filename,
                  path: dest,
                  size: stat.size,
                  mimeType: guessMimeType(filename),
                  projectId: args.projectId,
                  taskId: task.id,
                  description: `Reference: ${basename(filePath)}`,
                },
              });
              attachedFiles.push(filename);
            } catch (e) {
              // Record the reason rather than silently dropping the attachment.
              attachmentFailures.push({
                reference: filePath,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }

          // Append reference info to task description with full absolute paths
          if (attachedFiles.length > 0) {
            const refText = attachedFiles.map((f) => `- ${join(dir, f)}`).join("\n");
            updatedDesc = (task.description ?? "") + `\n\nAttached references:\n${refText}`;
            await db.task.update({ where: { id: task.id }, data: { description: updatedDesc } });
          }
        }
      }

      // Attachment outcomes ride along on every return path so the assistant
      // reports the real result instead of guessing why an image didn't land.
      const attachmentInfo = attachmentFailures.length > 0 ? { attachmentFailures } : {};

      // Auto-start execution if requested — pass title as prompt since
      // startPtyExecution already injects task description as context.
      //
      // We always surface the outcome on the response so the assistant doesn't
      // claim "Execution started" when the kanban still shows TODO. Common
      // failure modes worth keeping visible:
      //   - Next.js server unreachable (wrong port / not running)
      //   - Concurrency limit hit (system.maxConcurrentExecutions)
      //   - Project missing localPath
      if (autoStart) {
        const PORT = process.env.PORT ?? "3000";
        const prompt = args.title;
        try {
          const res = await fetch(`http://localhost:${PORT}/api/internal/terminal/${task.id}/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt }),
          });
          if (res.ok) {
            const execData = await res.json();
            return { ...task, ...attachmentInfo, execution: execData };
          }
          let errMsg = `HTTP ${res.status}`;
          try {
            const errBody = (await res.json()) as { error?: string };
            if (errBody?.error) errMsg = errBody.error;
          } catch {
            /* response body wasn't JSON; keep status code */
          }
          return { ...task, ...attachmentInfo, execution: null, executionError: errMsg };
        } catch (err) {
          return {
            ...task,
            ...attachmentInfo,
            execution: null,
            executionError: err instanceof Error ? err.message : String(err),
          };
        }
      }

      return { ...task, ...attachmentInfo };
    },
  },

  update_task: {
    description:
      "Update a task's title, description, priority, labels, subPath, and/or version. If labelIds is provided, replaces all existing labels. " +
      "Pass versionId to file the task under a project version (use list_versions to discover options); pass null or an empty string to move it back to the backlog (no version).",
    schema: z.object({
      taskId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: Priority.optional(),
      labelIds: z.array(z.string()).optional(),
      subPath: z.string().optional(),
      versionId: z.string().nullable().optional().describe("Version to assign the task to. Use list_versions to find valid IDs for the project. Pass null or \"\" to move the task to the backlog (no version)."),
    }),
    handler: async (args: {
      taskId: string;
      title?: string;
      description?: string;
      priority?: string;
      labelIds?: string[];
      subPath?: string;
      versionId?: string | null;
    }) => {
      const { labelIds, taskId, versionId, ...updateData } = args;
      const versionProvided = "versionId" in args;

      return db.$transaction(async (tx) => {
        // Resolve the version change before updating. A version must belong to
        // the task's own project; an empty/null value (or a mismatch) clears it
        // → task moves back to the backlog.
        let versionData: { versionId?: string | null } = {};
        if (versionProvided) {
          let resolved: string | null = null;
          if (versionId) {
            const current = await tx.task.findUnique({
              where: { id: taskId },
              select: { projectId: true },
            });
            if (current) {
              const v = await tx.version.findFirst({
                where: { id: versionId, projectId: current.projectId },
                select: { id: true },
              });
              resolved = v?.id ?? null;
            }
          }
          versionData = { versionId: resolved };
        }

        const task = await tx.task.update({
          where: { id: taskId },
          data: {
            ...(updateData as { title?: string; description?: string; priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; subPath?: string }),
            ...versionData,
          },
        });

        if (labelIds !== undefined) {
          await tx.taskLabel.deleteMany({ where: { taskId } });
          if (labelIds.length > 0) {
            await tx.taskLabel.createMany({
              data: labelIds.map((labelId) => ({ taskId, labelId })),
            });
          }
        }

        return task;
      });
    },
  },

  move_task: {
    description: "Move a task to a different status column (e.g. TODO, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED).",
    schema: z.object({
      taskId: z.string(),
      status: TaskStatus,
    }),
    handler: async (args: { taskId: string; status: string }) => {
      // Delegate to updateTaskStatus to trigger side effects (dreaming on DONE, worktree cleanup on CANCELLED, etc.)
      const { updateTaskStatus } = await import("@/actions/task-actions");
      return updateTaskStatus(args.taskId, args.status as "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED");
    },
  },

  delete_task: {
    description: "Delete a task by ID.",
    schema: z.object({
      taskId: z.string(),
    }),
    handler: async (args: { taskId: string }) => {
      await db.task.delete({ where: { id: args.taskId } });
      return { deleted: true, taskId: args.taskId };
    },
  },

  set_task_defaults: {
    description:
      "Save the user's default behavior for new tasks: useWorktree (Git worktree branch isolation) and autoStart (run immediately after create). " +
      "Call this once after asking the user their preference — subsequent create_task calls without an explicit useWorktree/autoStart use these defaults and won't prompt again. Applies globally to all projects.",
    schema: z.object({
      useWorktree: z.boolean(),
      autoStart: z.boolean(),
    }),
    handler: async (args: { useWorktree: boolean; autoStart: boolean }) => {
      const set = (key: string, value: unknown) =>
        db.systemConfig.upsert({
          where: { key },
          create: { key, value: JSON.stringify(value) },
          update: { value: JSON.stringify(value) },
        });
      await set("task.defaultUseWorktree", args.useWorktree);
      await set("task.defaultAutoStart", args.autoStart);
      await set("task.mcpDefaultsConfigured", true);
      return { ok: true, useWorktree: args.useWorktree, autoStart: args.autoStart };
    },
  },

  list_versions: {
    description:
      "List a project's active versions (excludes RELEASED) for assigning a task via create_task's or update_task's versionId. Returns id, number, name, status, isCurrent.",
    schema: z.object({ projectId: z.string() }),
    handler: async (args: { projectId: string }) => {
      return db.version.findMany({
        where: { projectId: args.projectId, status: { not: "RELEASED" } },
        select: { id: true, number: true, name: true, status: true, isCurrent: true },
        orderBy: [{ isCurrent: "desc" }, { order: "asc" }, { createdAt: "desc" }],
      });
    },
  },
};
