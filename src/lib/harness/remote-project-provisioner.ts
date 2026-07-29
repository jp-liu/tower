import "server-only";

import { execFile } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectAccessMode } from "@prisma/client";
import { db } from "@/lib/db";
import { parseGitUrl, toCloneUrl } from "@/lib/git-url";
import { ensureTowerTask } from "@/lib/instrumentation-tasks";
import { syncProjectDoc } from "@/lib/group-doc";

const execFileAsync = promisify(execFile);

export interface RemoteProjectProvisionInput {
  gitUrl?: string;
  workspaceId?: string;
  localRoot?: string;
  name?: string;
  directoryName?: string;
  accessMode?: Exclude<ProjectAccessMode, "NORMAL">;
}

interface ProvisionDependencies {
  cloneRepository?: (cloneUrl: string, targetPath: string) => Promise<void>;
}

function repositoryIdentity(raw: string): string {
  const parsed = parseGitUrl(toCloneUrl(raw));
  if (!parsed || parsed.pathSegments.length === 0) throw new Error("Unsupported or invalid Git URL");
  return `${parsed.host.toLowerCase()}/${parsed.pathSegments.join("/").toLowerCase()}`;
}

function repositoryName(raw: string): string {
  const parsed = parseGitUrl(toCloneUrl(raw));
  const name = parsed?.pathSegments.at(-1)?.trim();
  if (!name) throw new Error("Cannot derive repository name from Git URL");
  return name;
}

function safeDirectoryName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || !/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error("directoryName must be one safe folder name");
  }
  return trimmed;
}

async function defaultCloneRepository(cloneUrl: string, targetPath: string): Promise<void> {
  await execFileAsync("git", ["clone", "--", cloneUrl, targetPath], {
    timeout: 5 * 60_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

async function existingOrigin(targetPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", targetPath, "remote", "get-url", "origin"], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function provisionRemoteProject(
  input: RemoteProjectProvisionInput,
  dependencies: ProvisionDependencies = {},
) {
  const missing = [
    !input.gitUrl?.trim() ? "gitUrl" : null,
    !input.workspaceId?.trim() ? "workspaceId" : null,
    !input.localRoot?.trim() ? "localRoot" : null,
  ].filter(Boolean) as string[];
  if (missing.length > 0) {
    return {
      needsInput: true,
      missing,
      message: `Please provide ${missing.join(", ")}. Tower will not guess the workspace or local root.`,
    };
  }

  const gitUrl = input.gitUrl!.trim();
  const cloneUrl = toCloneUrl(gitUrl);
  const identity = repositoryIdentity(cloneUrl);
  const workspaceId = input.workspaceId!.trim();
  const localRoot = path.resolve(input.localRoot!.trim());
  if (!path.isAbsolute(input.localRoot!.trim())) throw new Error("localRoot must be an absolute path");
  const directoryName = safeDirectoryName(input.directoryName || repositoryName(cloneUrl));
  const targetPath = path.resolve(localRoot, directoryName);
  if (targetPath !== path.join(localRoot, directoryName) || !targetPath.startsWith(`${localRoot}${path.sep}`)) {
    throw new Error("Resolved repository path escapes localRoot");
  }
  if (input.accessMode === "FULL_WORK") {
    throw new Error(
      "Remote projects must be provisioned as REVIEW_ONLY first. The owner may explicitly upgrade the registered project to FULL_WORK afterward.",
    );
  }
  const accessMode = "REVIEW_ONLY" as const;

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!workspace) throw new Error("Workspace not found");

  const candidates = await db.project.findMany({
    where: {
      OR: [
        { localPath: targetPath },
        { gitUrl: { not: null } },
      ],
    },
    select: { id: true, name: true, gitUrl: true, localPath: true, workspaceId: true, accessMode: true },
  });
  const existing = candidates.find((project) =>
    project.localPath === targetPath
    || (project.gitUrl
      ? (() => {
          try {
            return repositoryIdentity(project.gitUrl) === identity;
          } catch {
            return false;
          }
        })()
      : false)
  );
  if (existing) {
    if (existing.workspaceId !== workspaceId) {
      throw new Error("Repository is already registered in a different workspace");
    }
    return {
      ok: true,
      deduped: true,
      cloned: false,
      project: existing,
      message: "Repository is already registered; no duplicate project was created.",
    };
  }

  await mkdir(localRoot, { recursive: true });
  let cloned = false;
  try {
    const targetStat = await stat(targetPath);
    if (!targetStat.isDirectory()) throw new Error("Target path exists and is not a directory");
    const entries = await readdir(targetPath);
    if (entries.length > 0) {
      const origin = await existingOrigin(targetPath);
      if (!origin || repositoryIdentity(origin) !== identity) {
        throw new Error("Target directory is non-empty and is not the requested Git repository");
      }
    } else {
      await (dependencies.cloneRepository ?? defaultCloneRepository)(cloneUrl, targetPath);
      cloned = true;
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") throw error;
    await (dependencies.cloneRepository ?? defaultCloneRepository)(cloneUrl, targetPath);
    cloned = true;
  }

  const projectName = input.name?.trim() || repositoryName(cloneUrl);
  let project;
  try {
    project = await db.project.create({
      data: {
        name: projectName,
        type: "GIT",
        gitUrl: cloneUrl,
        repositoryKey: identity,
        localPath: targetPath,
        workspaceId,
        accessMode,
        facts: {
          create: [
            { key: "remoteProvisioning.source", value: cloneUrl },
            { key: "remoteProvisioning.accessMode", value: accessMode },
          ],
        },
      },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code !== "P2002") throw error;
    const concurrent = await db.project.findUnique({
      where: { repositoryKey: identity },
    });
    if (!concurrent) throw error;
    const workbenchTaskId = await ensureTowerTask(concurrent.id, concurrent.name);
    return {
      ok: true,
      deduped: true,
      cloned,
      project: concurrent,
      workbenchTaskId,
      message: "A concurrent request already registered this repository; Tower reused that project.",
    };
  }
  const workbenchTaskId = await ensureTowerTask(project.id, project.name);
  await syncProjectDoc(db, project.id);
  return {
    ok: true,
    deduped: false,
    cloned,
    project,
    workbenchTaskId,
    safety: accessMode === "REVIEW_ONLY"
      ? "Repository registered in REVIEW_ONLY mode. No dependency install or repository script was executed."
      : "Repository registered in FULL_WORK mode. Provisioning still did not install dependencies or execute repository scripts.",
  };
}

export async function setRemoteProjectAccessMode(
  projectId: string,
  accessMode: Exclude<ProjectAccessMode, "NORMAL">,
) {
  const project = await db.project.update({
    where: { id: projectId },
    data: {
      accessMode,
      facts: {
        upsert: {
          where: { projectId_key: { projectId, key: "remoteProvisioning.accessMode" } },
          create: { key: "remoteProvisioning.accessMode", value: accessMode },
          update: { value: accessMode },
        },
      },
    },
  });
  await syncProjectDoc(db, projectId);
  return {
    ok: true,
    projectId,
    accessMode: project.accessMode,
    message: accessMode === "FULL_WORK"
      ? "FULL_WORK enabled by the owner."
      : "REVIEW_ONLY enabled; repository work must remain read-only.",
  };
}

export async function getRemoteProjectProvisionStatus(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      gitUrl: true,
      localPath: true,
      accessMode: true,
      workspace: { select: { id: true, name: true } },
      tasks: {
        orderBy: { createdAt: "asc" },
        take: 20,
        select: {
          id: true,
          title: true,
          status: true,
          labels: { select: { label: { select: { name: true, isBuiltin: true } } } },
        },
      },
    },
  });
  if (!project) throw new Error("Project not found");
  const workbench = project.tasks.find((task) =>
    task.labels.some(({ label }) => label.name === "Tower" && label.isBuiltin)
    || task.title === `${project.name}-Tower`
  ) ?? null;
  const { tasks: _, ...projectWithoutTasks } = project;
  void _;
  return {
    project: projectWithoutTasks,
    workbench: workbench ? { id: workbench.id, status: workbench.status } : null,
  };
}
