import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import simpleGit, { type StatusResult } from "simple-git";
import { parseUnifiedDiff } from "@/lib/git-diff";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

// Resolve to the actual git repo root so callers that pass a subdirectory
// (e.g. project.localPath = repo/, task subPath = a child of repo/) still get
// consistent results — `git status` paths are repo-root-relative, and any
// pathspec we send must be interpreted from the same cwd to match.
function resolveGitTopLevel(dir: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
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

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  summary: string;
  date?: string;
}

export function parseBlamePorcelain(raw: string): BlameLine[] {
  const result: BlameLine[] = [];
  const lines = raw.split("\n");
  let i = 0;

  // Per-sha metadata cache: sha → { author, summary, date }
  const shaMetaCache: Record<string, { author: string; summary: string; date: string }> = {};

  while (i < lines.length) {
    const headerLine = lines[i];
    if (!headerLine) { i++; continue; }

    // First token check: sha (40 hex chars) + at least 2 numbers
    const headerMatch = headerLine.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)(?:\s+\d+)?$/);
    if (!headerMatch) { i++; continue; }

    const sha = headerMatch[1];
    const finalLine = parseInt(headerMatch[2], 10);
    i++;

    let author = "";
    let summary = "";
    let date = "";

    // Consume header key-value lines until we hit the tab-prefixed content line
    while (i < lines.length && !lines[i].startsWith("\t")) {
      const kv = lines[i];
      if (kv.startsWith("author ")) author = kv.slice(7).trim();
      else if (kv.startsWith("summary ")) summary = kv.slice(8).trim();
      else if (kv.startsWith("author-time ")) {
        const ts = parseInt(kv.slice(12).trim(), 10);
        if (!isNaN(ts)) date = new Date(ts * 1000).toISOString();
      }
      i++;
    }

    // Skip the tab-prefixed content line
    if (i < lines.length && lines[i].startsWith("\t")) i++;

    // If this sha appeared before (no author metadata emitted), pull from cache
    if (!author && shaMetaCache[sha]) {
      author = shaMetaCache[sha].author;
      summary = shaMetaCache[sha].summary;
      date = shaMetaCache[sha].date;
    } else if (author) {
      shaMetaCache[sha] = { author, summary, date };
    }

    result.push({ line: finalLine, sha, author, summary, date: date || undefined });
  }

  return result;
}

// GET: git info for a path
export async function GET(request: NextRequest) {
  const dirPath = request.nextUrl.searchParams.get("path");
  if (!dirPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  try {
    const resolved = path.resolve(expandHome(dirPath));
    // Walk up via `git rev-parse --show-toplevel` so we work when the caller
    // passed a subdirectory of the actual repo. The old `.git` existsSync
    // check both missed this case and falsely matched stray `.git/` dirs.
    const topLevel = resolveGitTopLevel(resolved);
    if (!topLevel) {
      return NextResponse.json({ isGit: false, path: resolved });
    }

    const git = simpleGit(topLevel);

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
          cwd: topLevel, encoding: "utf-8", timeout: 5000,
        }).trim();
        hasWorktrees = raw.split("\n\n").filter(Boolean).length > 1;
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      isGit: true,
      path: resolved,
      topLevel,
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
  // `init` creates a brand-new repo at `resolved`. Every other action operates
  // on an existing repo — resolve to the actual toplevel so pathspecs like
  // `git diff -- web/foo.js` work even when the caller passed a subdir cwd.
  const opRoot = action === "init"
    ? resolved
    : (resolveGitTopLevel(resolved) ?? resolved);
  const git = simpleGit(opRoot);

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

      case "discard-file": {
        const safeFile = sanitizeFilePath(body.file);
        // For untracked files, remove them; for tracked files, restore from HEAD
        try {
          await git.checkout(["--", safeFile]);
        } catch {
          // File might be untracked — clean it
          await git.clean("f", [safeFile]);
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
          return NextResponse.json({ success: true, content: content.replace(/\r\n/g, "\n") });
        } catch {
          return NextResponse.json({ success: true, content: "" });
        }
      }

      case "log-graph": {
        const rawLimit = parseInt(body.limit ?? "200", 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 200;
        try {
          // Fields per record: hash | parents | author | date | refs | subject | body.
          // Records are NUL-separated (`-z`) because %b can contain newlines.
          // Fields within a record are ASCII US-separated (\x1f) — safe vs any
          // commit content (subjects/bodies cannot contain \x1f or \0).
          const SEP = "\x1f";
          // No `--all` / `--branches` — `git log` with no ref defaults to HEAD,
          // which is the current branch's reachable history (matching what
          // donjayamanne's gitHistoryVSCode does for its "current branch" mode).
          // Side branches that have been merged into HEAD still appear (via
          // merge commits' second parents); unmerged refs are correctly hidden.
          const raw = await git.raw([
            "log",
            "-z",
            `--max-count=${limit}`,
            `--format=%H${SEP}%P${SEP}%an${SEP}%aI${SEP}%D${SEP}%s${SEP}%b`,
          ]);
          const records = raw.split("\0").filter((r) => r.length > 0);
          const commits = records.map((rec) => {
            const [hash, parentsStr, author, date, refsStr, subject, bodyRaw] = rec.split(SEP);
            const parents = parentsStr ? parentsStr.split(" ").filter(Boolean) : [];
            // %D yields e.g. "HEAD -> main, origin/main, tag: v1.0"
            const refs = refsStr
              ? refsStr.split(",").map((r) => r.trim().replace(/^HEAD -> /, "").replace(/^tag: /, "")).filter(Boolean)
              : [];
            return {
              hash,
              shortHash: hash.slice(0, 7),
              parents,
              author: author ?? "",
              date: date ?? "",
              subject: subject ?? "",
              body: (bodyRaw ?? "").replace(/\n+$/, ""),
              refs,
            };
          });
          let head: string | null = null;
          try { head = (await git.revparse(["HEAD"])).trim(); } catch { /* detached or empty repo */ }
          return NextResponse.json({ commits, head });
        } catch {
          return NextResponse.json({ commits: [], head: null });
        }
      }

      case "show-commit": {
        const { hash } = body;
        if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
          return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
        }
        try {
          // Get the patch with diff for all files in this commit (vs first parent).
          // For a merge: shows changes vs first parent. For a root: shows full file content as +.
          // Pass `-c core.quotepath=false` so non-ASCII filenames (Chinese,
          // emoji, etc.) appear verbatim in the patch instead of being quoted
          // and octal-escaped like `"a/\346\265\213\350\257\225.md"`. Without
          // this, the client's per-file slicer (which matches on `a/<filename>`)
          // misses those files and renders an empty diff.
          const patch = await git.raw([
            "-c", "core.quotepath=false",
            "show", hash, "--format=",
          ]);
          // Per-file breakdown via parseUnifiedDiff (parse-diff, already a dep, used in DiffView).
          // NOTE: files[].patch is intentionally empty — clients should slice the
          // full patch by `diff --git a/<filename>` markers (cheap on the client,
          // avoids re-stringification on the server).
          const parsed = parseUnifiedDiff(patch);
          const files = parsed.map((f) => {
            const filename = f.to && f.to !== "/dev/null" ? f.to : (f.from ?? "");
            let added = 0;
            let removed = 0;
            const isBinary = false;
            for (const chunk of f.chunks) {
              for (const c of chunk.changes) {
                if (c.type === "add") added++;
                else if (c.type === "del") removed++;
              }
            }
            return { filename, added, removed, isBinary, patch: "" };
          });
          return NextResponse.json({ patch: patch.replace(/\r\n/g, "\n"), files });
        } catch {
          return NextResponse.json({ error: "commit not found or unreadable" }, { status: 404 });
        }
      }

      case "commit-file-content": {
        const { hash, file } = body;
        if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
          return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
        }
        if (typeof file !== "string" || !file.trim()) {
          return NextResponse.json({ error: "file required" }, { status: 400 });
        }
        const safeFile = sanitizeFilePath(file);
        // Fetch before (parent's version) and after (this commit's version).
        // Each side may legitimately not exist:
        //   - Added file: parent has no such path → before is null
        //   - Deleted file: this commit has no such path → after is null
        //   - Root commit: there is no parent at all → before is null
        // Pass core.quotepath=false so non-ASCII paths aren't octal-escaped.
        let before: string | null = null;
        try {
          before = await git.raw([
            "-c", "core.quotepath=false",
            "show", `${hash}^:${safeFile}`,
          ]);
        } catch { /* file didn't exist at parent — leave null */ }
        let after: string | null = null;
        try {
          after = await git.raw([
            "-c", "core.quotepath=false",
            "show", `${hash}:${safeFile}`,
          ]);
        } catch { /* file deleted in this commit — leave null */ }
        return NextResponse.json({
          before: before === null ? null : before.replace(/\r\n/g, "\n"),
          after: after === null ? null : after.replace(/\r\n/g, "\n"),
        });
      }

      case "checkout-commit": {
        const { hash } = body;
        if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
          return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
        }
        try {
          // Detached HEAD checkout. Refuses if there are uncommitted local changes.
          await git.checkout([hash]);
          return NextResponse.json({ success: true });
        } catch (e) {
          return NextResponse.json(
            { error: (e as Error).message || "Checkout failed (uncommitted changes?)" },
            { status: 500 }
          );
        }
      }

      case "reset-commit": {
        const { hash, mode } = body;
        if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
          return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
        }
        const safeMode = mode === "soft" || mode === "mixed" || mode === "hard" ? mode : "mixed";
        try {
          await git.reset([`--${safeMode}`, hash]);
          return NextResponse.json({ success: true, mode: safeMode });
        } catch (e) {
          return NextResponse.json(
            { error: (e as Error).message || "Reset failed" },
            { status: 500 }
          );
        }
      }

      case "create-tag": {
        const { hash, name, message } = body;
        if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
          return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
        }
        if (typeof name !== "string" || !name.trim()) {
          return NextResponse.json({ error: "tag name required" }, { status: 400 });
        }
        const safeName = name.trim().replace(/[^a-zA-Z0-9_\-./]/g, "");
        if (!safeName) {
          return NextResponse.json({ error: "tag name invalid" }, { status: 400 });
        }
        try {
          if (typeof message === "string" && message.trim()) {
            await git.tag(["-a", safeName, hash, "-m", message.trim()]);
          } else {
            await git.tag([safeName, hash]);
          }
          return NextResponse.json({ success: true, name: safeName });
        } catch (e) {
          return NextResponse.json(
            { error: (e as Error).message || "Tag creation failed" },
            { status: 500 }
          );
        }
      }

      case "cherry-pick": {
        const { hash } = body;
        if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
          return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
        }
        try {
          await git.raw(["cherry-pick", hash]);
          return NextResponse.json({ success: true });
        } catch (e) {
          return NextResponse.json(
            { error: (e as Error).message || "Cherry-pick failed (conflict?)" },
            { status: 500 }
          );
        }
      }

      case "revert": {
        const { hash } = body;
        if (typeof hash !== "string" || !/^[a-f0-9]{4,40}$/i.test(hash)) {
          return NextResponse.json({ error: "invalid commit hash" }, { status: 400 });
        }
        try {
          // --no-edit auto-fills "Revert <subject>" message
          await git.raw(["revert", "--no-edit", hash]);
          return NextResponse.json({ success: true });
        } catch (e) {
          return NextResponse.json(
            { error: (e as Error).message || "Revert failed (conflict?)" },
            { status: 500 }
          );
        }
      }

      case "amend-message": {
        const { message } = body;
        if (typeof message !== "string" || !message.trim()) {
          return NextResponse.json({ error: "message required" }, { status: 400 });
        }
        try {
          // git commit --amend ALWAYS targets HEAD. Caller responsibility to ensure
          // this is invoked only when the selected commit IS the current HEAD.
          await git.raw(["commit", "--amend", "-m", message.trim()]);
          return NextResponse.json({ success: true });
        } catch (e) {
          return NextResponse.json(
            { error: (e as Error).message || "Amend failed" },
            { status: 500 }
          );
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

      case "log-file": {
        const safeFile = sanitizeFilePath(body.file);
        const rawLimit = parseInt(body.limit ?? "50", 10);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
        try {
          const log = await git.log({ file: safeFile, maxCount: limit });
          const commits = log.all.map((c) => ({
            hash: c.hash,
            shortHash: c.hash.slice(0, 7),
            message: c.message,
            author: c.author_name,
            date: c.date,
          }));
          return NextResponse.json({ commits });
        } catch {
          return NextResponse.json({ commits: [] });
        }
      }

      case "diff-file": {
        // Used by the code editor's gutter markers — runs `git diff` for one
        // file and returns the raw unified patch (paths are repo-root-relative).
        const safeFile = sanitizeFilePath(body.file);
        const staged = Boolean(body.staged);
        const patch = staged
          ? await git.diff(["--cached", "--", safeFile])
          : await git.diff(["--", safeFile]);
        return NextResponse.json({ patch: patch.replace(/\r\n/g, "\n") });
      }

      case "blame": {
        const safeFile = sanitizeFilePath(body.file);
        try {
          const raw = await git.raw(["blame", "--porcelain", safeFile]);
          const lines = parseBlamePorcelain(raw);
          return NextResponse.json({ lines });
        } catch {
          return NextResponse.json({ lines: [] });
        }
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Internal git operation failed" }, { status: 500 });
  }
}
