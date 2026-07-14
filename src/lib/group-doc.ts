// src/lib/group-doc.ts — NO Next.js imports.
// Writes a product-group declaration into each member repo's root
// `CLAUDE.local.md`, so an agent working in any member repo knows which sibling
// repos exist and where they live — and can read them on demand.
//
// Takes `db: PrismaClient` as a parameter (DI, same convention as knowledge.ts):
// MCP runs as a standalone stdio process and cannot import `"use server"`
// modules, and both server actions and MCP tools must be able to call this.
//
// Why `CLAUDE.local.md` and nothing else:
//   - The block contains absolute machine-local paths. CLAUDE.md / AGENTS.md /
//     README.md are all tracked, so writing there would push this machine's
//     paths to every teammate. `CLAUDE.local.md` is Claude Code's "project +
//     user-private" convention: auto-loaded, by convention never committed.
//   - Being git-ignored does not stop it from being loaded.
//   - Worktrees live at `<localPath>/.worktrees/task-x`; Claude Code loads
//     upwards from cwd, so the project root copy already covers them. One file
//     per repo, never per worktree.
//
// The file is kept out of git via `.git/info/exclude` (local, never committed)
// rather than `.gitignore` (tracked — editing it would produce a diff for the
// teammates this whole design exists to protect).

import type { PrismaClient } from "@prisma/client";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { dirname, join, resolve } from "path";
import { promisify } from "util";
import { safeResolvePath } from "./fs-security";
import { expandHome } from "./git-url";

const execFileAsync = promisify(execFile);

const DOC_FILE = "CLAUDE.local.md";
const START_MARKER = "# Tower Config Env Start";
const END_MARKER = "# Tower Config Env End";

type MemberProject = {
  id: string;
  name: string;
  alias: string | null;
  localPath: string | null;
};

/**
 * Rewrite the Tower block in every current member's `CLAUDE.local.md`.
 * Group-scoped on purpose: one project joining/leaving changes what every other
 * member's block lists, so the whole group is re-rendered. Null → no-op.
 */
export async function syncGroupDoc(db: PrismaClient, groupId: string | null): Promise<void> {
  if (!groupId) return;
  const group = await db.productGroup.findUnique({ where: { id: groupId }, select: { name: true } });
  if (!group) return;
  const members = await db.project.findMany({
    where: { groupId },
    select: { id: true, name: true, alias: true, localPath: true },
    orderBy: { createdAt: "asc" },
  });
  for (const member of members) {
    await writeDoc(member, renderBlock(group.name, member, members));
  }
}

/**
 * Refresh one project's block. Grouped → re-render the whole group (the project's
 * own path appears in its siblings' blocks too). Ungrouped → strip the block.
 */
export async function syncProjectDoc(db: PrismaClient, projectId: string): Promise<void> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, alias: true, localPath: true, groupId: true },
  });
  if (!project) return;
  if (project.groupId) {
    await syncGroupDoc(db, project.groupId);
    return;
  }
  await writeDoc(project, null);
}

/**
 * Idempotent upsert of our marked block, leaving everything outside the markers
 * byte-for-byte intact (the user may keep their own notes in the same file).
 * Same "only touch what we marked" convention as `upsertHook` in
 * claude-cli-adapter.ts and `cleanupLegacyAssistantMcp` in init-tower.ts.
 *
 * `block === null` removes the block; an empty result means the file should go.
 */
export function upsertMarkedBlock(content: string, block: string | null): string {
  const start = content.indexOf(START_MARKER);
  const end = start === -1 ? -1 : content.indexOf(END_MARKER, start + START_MARKER.length);

  if (start !== -1 && end !== -1) {
    const before = content.slice(0, start);
    const after = content.slice(end + END_MARKER.length);
    if (block === null) {
      // Collapse the separator we inserted when appending, keep user text.
      const merged = before.replace(/\n{2,}$/, "\n") + after.replace(/^\n+/, "");
      return merged.trim() === "" ? "" : merged;
    }
    return `${before}${START_MARKER}\n${block}\n${END_MARKER}${after}`;
  }

  if (block === null) return content;
  const sep = content === "" || content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${sep}${START_MARKER}\n${block}\n${END_MARKER}\n`;
}

/** Declaration + links only — siblings are read on demand, never inlined here. */
function renderBlock(groupName: string, self: MemberProject, members: MemberProject[]): string | null {
  const siblings = members.filter((m) => m.id !== self.id && m.localPath);
  // ponytail: a group of one has nothing to point at — drop the block instead of
  // leaving an empty list behind. It comes back when a second member joins.
  if (siblings.length === 0) return null;
  return [
    `## Tower Product Group: ${groupName}`,
    `This repo belongs to product group "${groupName}". Its sibling repos are listed below —`,
    "read one only when the task actually needs it; skip them otherwise.",
    ...siblings.map(
      (s) => `- ${s.name}${s.alias ? ` (${s.alias})` : ""} — ${resolve(expandHome(s.localPath!))}`
    ),
    "For cross-repo questions the MCP tool `ask_project_knowledge` searches the whole group at once.",
  ].join("\n");
}

/**
 * Write/refresh/remove one repo's `CLAUDE.local.md`. Every failure degrades to a
 * warning: this is a side effect of update_project / setProjectGroup, and must
 * never take the main operation down with it (same call as knowledge.ts).
 */
async function writeDoc(project: MemberProject, block: string | null): Promise<void> {
  try {
    if (!project.localPath) {
      console.warn(`[group-doc] ${project.name}: no localPath, skipped`);
      return;
    }
    const root = resolve(expandHome(project.localPath));
    const file = safeResolvePath(root, DOC_FILE);

    const existing = await fs.readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return "";
      throw e;
    });
    const next = upsertMarkedBlock(existing, block);
    if (next === existing) return;

    if (next === "") {
      await fs.rm(file, { force: true });
      return;
    }
    await ensureGitExclude(root);
    await fs.writeFile(file, next, "utf8");
  } catch (e) {
    console.warn(`[group-doc] ${project.name}: failed to sync ${DOC_FILE}:`, e);
  }
}

/**
 * Idempotently add `CLAUDE.local.md` to the repo's `.git/info/exclude` — local,
 * never committed, and (living in the common gitdir) effective for every
 * worktree of the repo at once. Non-git dir → warn and move on.
 */
async function ensureGitExclude(root: string): Promise<void> {
  let gitDir: string;
  try {
    // `--git-common-dir` resolves the shared gitdir whether `.git` is a real
    // directory, a worktree pointer file, or a submodule link.
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-common-dir"], { cwd: root });
    gitDir = resolve(root, stdout.trim());
  } catch {
    console.warn(`[group-doc] ${root}: not a git repo, ${DOC_FILE} left un-excluded`);
    return;
  }

  const excludeFile = join(gitDir, "info", "exclude");
  const existing = await fs.readFile(excludeFile, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return "";
    throw e;
  });
  if (existing.split("\n").some((line) => line.trim() === DOC_FILE)) return;

  await fs.mkdir(dirname(excludeFile), { recursive: true });
  const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
  await fs.appendFile(excludeFile, `${sep}${DOC_FILE}\n`, "utf8");
}
