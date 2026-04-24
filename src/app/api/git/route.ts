import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import simpleGit, { type StatusResult } from "simple-git";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function sanitizeFilePath(file: string): string {
  const normalized = path.normalize(file);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("Invalid file path");
  }
  return normalized;
}

function sanitizeFilePaths(files: unknown): string[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("files required");
  }
  return files.map((f) => {
    if (typeof f !== "string" || !f.trim()) throw new Error("invalid file path");
    return sanitizeFilePath(f);
  });
}

function mapStatus(s: StatusResult) {
  const changedFiles: { file: string; status: string; staged: boolean }[] = [];

  for (const f of s.staged) {
    changedFiles.push({ file: f, status: "modified", staged: true });
  }
  for (const f of s.created) {
    // created can be staged or unstaged
    const isStaged = !s.not_added.includes(f);
    changedFiles.push({ file: f, status: "added", staged: isStaged });
  }
  for (const f of s.deleted) {
    changedFiles.push({ file: f, status: "deleted", staged: true });
  }
  for (const f of s.renamed) {
    changedFiles.push({ file: (f as unknown as { to: string }).to ?? f, status: "renamed", staged: true });
  }
  for (const f of s.modified) {
    // modified can be staged or unstaged — check if also in staged
    if (!s.staged.includes(f)) {
      changedFiles.push({ file: f, status: "modified", staged: false });
    }
  }
  for (const f of s.not_added) {
    if (!changedFiles.some((c) => c.file === f)) {
      changedFiles.push({ file: f, status: "untracked", staged: false });
    }
  }

  return {
    summary: {
      modified: s.modified.length,
      staged: s.staged.length + s.created.filter((f) => !s.not_added.includes(f)).length + s.deleted.length,
      untracked: s.not_added.length,
    },
    changedFiles,
  };
}

// GET: git info for a path
export async function GET(request: NextRequest) {
  const dirPath = request.nextUrl.searchParams.get("path");
  if (!dirPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  try {
    const resolved = path.resolve(expandHome(dirPath));
    const gitDir = path.join(resolved, ".git");

    if (!fs.existsSync(gitDir)) {
      return NextResponse.json({ isGit: false, path: resolved });
    }

    const git = simpleGit(resolved);

    // Parallel: status, branches, log, stash, remote
    const [status, branchSummary, remotes] = await Promise.all([
      git.status(),
      git.branch(),
      git.getRemotes(true),
    ]);

    const currentBranch = branchSummary.current;
    const branches = branchSummary.all.filter((b) => !b.startsWith("remotes/"));
    const remoteBranches = branchSummary.all
      .filter((b) => b.startsWith("remotes/origin/"))
      .map((b) => b.replace("remotes/origin/", ""))
      .filter((b) => b !== "HEAD");

    const { summary: statusSummary, changedFiles } = mapStatus(status);

    const remoteUrl = remotes.find((r) => r.name === "origin")?.refs?.fetch ?? "";

    // Ahead / behind
    let ahead = status.ahead ?? 0;
    let behind = status.behind ?? 0;

    // Commits
    const rawLimit = parseInt(request.nextUrl.searchParams.get("logLimit") || "20", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 20;
    let commits: { hash: string; shortHash: string; message: string; author: string; date: string }[] = [];
    try {
      const log = await git.log({ maxCount: limit });
      commits = log.all.map((c) => ({
        hash: c.hash,
        shortHash: c.hash.slice(0, 7),
        message: c.message,
        author: c.author_name,
        date: c.date,
      }));
    } catch {
      // empty repo
    }

    // Stash
    let stashes: { index: number; message: string }[] = [];
    try {
      const stashList = await git.stashList();
      stashes = stashList.all.map((s, i) => ({
        index: i,
        message: s.message,
      }));
    } catch {
      // no stashes
    }

    // Worktree check
    let hasWorktrees = false;
    if (request.nextUrl.searchParams.get("checkWorktrees") === "true") {
      try {
        const raw = execFileSync("git", ["worktree", "list", "--porcelain"], {
          cwd: resolved, encoding: "utf-8", timeout: 5000,
        }).trim();
        hasWorktrees = raw.split("\n\n").filter(Boolean).length > 1;
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      isGit: true,
      path: resolved,
      currentBranch,
      branches,
      remoteBranches,
      remoteUrl,
      statusSummary,
      changedFiles,
      ahead,
      behind,
      commits,
      stashes,
      hasWorktrees,
    });
  } catch {
    return NextResponse.json({ error: "Failed to read git info" }, { status: 500 });
  }
}

// POST: git actions
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, path: dirPath } = body;

  // Clone: special case — target dir may not exist yet
  if (action === "clone") {
    const { url, path: clonePath } = body;
    if (!url || !clonePath) {
      return NextResponse.json({ error: "url and path required" }, { status: 400 });
    }
    if (typeof clonePath === "string" && clonePath.startsWith("~")) {
      return NextResponse.json({ error: "请输入绝对路径，不支持 ~ 别名" }, { status: 400 });
    }
    const resolved = path.resolve(expandHome(clonePath));
    if (fs.existsSync(resolved) && fs.readdirSync(resolved).length > 0) {
      if (fs.existsSync(path.join(resolved, ".git"))) {
        return NextResponse.json({ success: true, message: "already_cloned", path: resolved });
      }
      return NextResponse.json({ error: "Directory already exists and is not empty" }, { status: 400 });
    }
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      await simpleGit().clone(url, resolved);
      return NextResponse.json({ success: true, message: "cloned", path: resolved });
    } catch {
      if (fs.existsSync(resolved) && fs.readdirSync(resolved).length === 0) {
        fs.rmdirSync(resolved);
      }
      return NextResponse.json({ error: "Clone failed" }, { status: 500 });
    }
  }

  if (!dirPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const resolved = path.resolve(expandHome(dirPath));
  const git = simpleGit(resolved);

  try {
    switch (action) {
      case "init": {
        if (!fs.existsSync(resolved)) {
          return NextResponse.json({ error: "Directory not found" }, { status: 400 });
        }
        await git.init();
        await git.add("-A");
        try { await git.commit("Initial commit", { "--allow-empty": null }); } catch { /* ok */ }
        return NextResponse.json({ success: true });
      }

      case "checkout": {
        const branch = body.branch;
        if (!branch) return NextResponse.json({ error: "branch required" }, { status: 400 });
        const safeBranch = branch.replace(/[^a-zA-Z0-9_\-\/\.]/g, "");
        if (!safeBranch) return NextResponse.json({ error: "Invalid branch name" }, { status: 400 });
        try {
          await git.checkout(safeBranch);
        } catch {
          // Try tracking remote branch
          try {
            await git.checkoutBranch(safeBranch, `origin/${safeBranch}`);
          } catch {
            return NextResponse.json({ error: `Branch "${branch}" not found` }, { status: 400 });
          }
        }
        return NextResponse.json({ success: true, branch: safeBranch });
      }

      case "fetch": {
        await git.fetch(["--prune"]);
        return NextResponse.json({ success: true });
      }

      case "stage": {
        const safeFiles = sanitizeFilePaths(body.files);
        await git.add(safeFiles);
        return NextResponse.json({ success: true });
      }

      case "unstage": {
        const safeFiles = sanitizeFilePaths(body.files);
        await git.reset(["--", ...safeFiles]);
        return NextResponse.json({ success: true });
      }

      case "commit": {
        const { message } = body;
        if (!message || typeof message !== "string" || !message.trim()) {
          return NextResponse.json({ error: "commit message required" }, { status: 400 });
        }
        try {
          await git.commit(message.trim());
        } catch (err: unknown) {
          const msg = (err as Error).message || "";
          if (msg.includes("nothing to commit") || msg.includes("no changes added")) {
            return NextResponse.json({ error: "Nothing to commit — stage files first" }, { status: 400 });
          }
          return NextResponse.json({ error: "Commit failed" }, { status: 500 });
        }
        return NextResponse.json({ success: true });
      }

      case "pull": {
        try {
          const { branch: pullBranch } = body;
          if (pullBranch) {
            const safeBranch = pullBranch.replace(/[^a-zA-Z0-9_\-\/\.]/g, "");
            await git.pull("origin", safeBranch, { "--rebase": null, "--autostash": null });
          } else {
            await git.pull(["--rebase", "--autostash"]);
          }
        } catch {
          return NextResponse.json({ error: "Pull failed" }, { status: 500 });
        }
        return NextResponse.json({ success: true });
      }

      case "push": {
        try {
          const { branch: pushBranch } = body;
          if (pushBranch) {
            const safeBranch = pushBranch.replace(/[^a-zA-Z0-9_\-\/\.]/g, "");
            await git.push("origin", safeBranch);
          } else {
            await git.push();
          }
        } catch {
          return NextResponse.json({ error: "Push failed" }, { status: 500 });
        }
        return NextResponse.json({ success: true });
      }

      case "discard-all": {
        await git.checkout(["--", "."]);
        await git.clean("f", ["-d"]);
        return NextResponse.json({ success: true });
      }

      case "show": {
        const { file, ref: gitRef } = body;
        if (!file || typeof file !== "string") {
          return NextResponse.json({ error: "file path required" }, { status: 400 });
        }
        const safeFile = sanitizeFilePath(file);
        const safeRef = (gitRef || "HEAD").replace(/[^a-zA-Z0-9_\-\/\.~^]/g, "");
        try {
          const content = await git.show(`${safeRef}:${safeFile}`);
          return NextResponse.json({ success: true, content });
        } catch {
          return NextResponse.json({ success: true, content: "" });
        }
      }

      case "stash-save": {
        const { message } = body;
        const args = ["push"];
        if (message && typeof message === "string" && message.trim()) {
          args.push("-m", message.trim());
        }
        await git.stash(args);
        return NextResponse.json({ success: true });
      }

      case "stash-pop": {
        const rawIndex = body.index;
        const safeIndex = typeof rawIndex === "number" && Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
        await git.stash(["pop", `stash@{${safeIndex}}`]);
        return NextResponse.json({ success: true });
      }

      case "stash-drop": {
        const rawIndex = body.index;
        const safeIndex = typeof rawIndex === "number" && Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
        await git.stash(["drop", `stash@{${safeIndex}}`]);
        return NextResponse.json({ success: true });
      }

      case "create-branch": {
        const { branch, baseBranch } = body;
        if (!branch) return NextResponse.json({ error: "branch name required" }, { status: 400 });
        const safeBranch = branch.replace(/[^a-zA-Z0-9_\-\/\.]/g, "-");
        const base = (baseBranch || "HEAD").replace(/[^a-zA-Z0-9_\-\/\.]/g, "");
        await git.checkoutBranch(safeBranch, base);
        return NextResponse.json({ success: true, branch: safeBranch });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Internal git operation failed" }, { status: 500 });
  }
}
