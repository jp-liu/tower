// @vitest-environment node
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import simpleGit from "simple-git";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { parseUnifiedDiff, hunkToPatch } from "@/lib/git-diff";
import { parseBlamePorcelain } from "../route";

// Helper to build a POST request
function makePost(body: object): NextRequest {
  return new NextRequest("http://localhost/api/git", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

// Build a 20-line file with two isolated hunks:
// - Hunk 1: line 1 changed (old: "line1-original")
// - Hunk 2: line 15 changed (old: "line15-original")
// The hunks are far enough apart that git produces two separate @@ sections.
function buildOriginalContent(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 20; i++) {
    if (i === 1) lines.push("line1-original");
    else if (i === 15) lines.push("line15-original");
    else lines.push(`line${i}`);
  }
  return lines.join("\n") + "\n";
}

function buildModifiedContent(): string {
  const lines: string[] = [];
  for (let i = 1; i <= 20; i++) {
    if (i === 1) lines.push("line1-modified");
    else if (i === 15) lines.push("line15-modified");
    else lines.push(`line${i}`);
  }
  return lines.join("\n") + "\n";
}

let repoPath: string;

beforeAll(async () => {
  // Create a real temp git repo
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "tower-git-test-"));
  const git = simpleGit(repoPath);

  await git.init();
  // Set up minimal git identity for commits
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");

  const filePath = path.join(repoPath, "test.txt");
  fs.writeFileSync(filePath, buildOriginalContent());
  await git.add("test.txt");
  await git.commit("Initial commit");

  // Modify the file — both hunks changed
  fs.writeFileSync(filePath, buildModifiedContent());
});

afterAll(() => {
  // Cleanup temp repo
  if (repoPath && fs.existsSync(repoPath)) {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// log-file tests use their own isolated repo to avoid polluting the shared repoPath state
let logFileRepoPath: string;

beforeAll(async () => {
  logFileRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "tower-git-logfile-test-"));
  const git = simpleGit(logFileRepoPath);
  await git.init();
  await git.addConfig("user.email", "test@test.com");
  await git.addConfig("user.name", "Test");

  // First commit
  fs.writeFileSync(path.join(logFileRepoPath, "history.txt"), "line1\n");
  await git.add("history.txt");
  await git.commit("First commit");

  // Second commit
  fs.writeFileSync(path.join(logFileRepoPath, "history.txt"), "line1\nline2\n");
  await git.add("history.txt");
  await git.commit("Second commit");
});

afterAll(() => {
  if (logFileRepoPath && fs.existsSync(logFileRepoPath)) {
    fs.rmSync(logFileRepoPath, { recursive: true, force: true });
  }
});

describe("POST /api/git log-file", () => {
  it("returns commits for a tracked file with correct shape", async () => {
    const req = makePost({ action: "log-file", path: logFileRepoPath, file: "history.txt" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.commits)).toBe(true);
    expect(data.commits.length).toBeGreaterThanOrEqual(2);

    const first = data.commits[0];
    expect(typeof first.hash).toBe("string");
    expect(first.hash.length).toBe(40);
    expect(typeof first.shortHash).toBe("string");
    expect(first.shortHash.length).toBe(7);
    expect(first.shortHash).toBe(first.hash.slice(0, 7));
    expect(typeof first.message).toBe("string");
    expect(typeof first.author).toBe("string");
    expect(typeof first.date).toBe("string");
  });

  it("returns empty commits array for a file not in the repo", async () => {
    const req = makePost({ action: "log-file", path: logFileRepoPath, file: "nonexistent.txt" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.commits).toEqual([]);
  });

  it("returns 500 for an invalid (absolute) file path", async () => {
    const req = makePost({ action: "log-file", path: logFileRepoPath, file: "/etc/passwd" });
    const res = await POST(req);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("respects limit parameter", async () => {
    const req = makePost({ action: "log-file", path: logFileRepoPath, file: "history.txt", limit: "1" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.commits.length).toBe(1);
  });
});

describe("POST /api/git diff-file", () => {
  it("returns a patch with both @@ markers for a modified file", async () => {
    const req = makePost({ action: "diff-file", path: repoPath, file: "test.txt" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.patch).toBe("string");
    // Should contain two hunk markers for our two isolated changes
    const hunks = data.patch.match(/@@/g);
    expect(hunks).not.toBeNull();
    expect(hunks!.length).toBeGreaterThanOrEqual(2);
    expect(data.patch).toContain("line1-original");
    expect(data.patch).toContain("line1-modified");
    expect(data.patch).toContain("line15-original");
    expect(data.patch).toContain("line15-modified");
  });

  it("returns empty patch for unstaged changes when staged=true and nothing staged", async () => {
    const req = makePost({ action: "diff-file", path: repoPath, file: "test.txt", staged: true });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.patch).toBe("");
  });

  it("returns non-200 if file path is invalid (absolute path)", async () => {
    const req = makePost({ action: "diff-file", path: repoPath, file: "/etc/passwd" });
    const res = await POST(req);
    // sanitizeFilePath throws "Invalid file path" → caught by outer try/catch → 500
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("POST /api/git stage-hunk", () => {
  it("stages only the first hunk — second hunk remains unstaged", async () => {
    // 1. Get the full unstaged diff
    const diffReq = makePost({ action: "diff-file", path: repoPath, file: "test.txt" });
    const diffRes = await POST(diffReq);
    const { patch: fullPatch } = await diffRes.json();
    expect(fullPatch).toBeTruthy();

    // 2. Parse and extract the first hunk
    const files = parseUnifiedDiff(fullPatch);
    expect(files).toHaveLength(1);
    expect(files[0].chunks.length).toBeGreaterThanOrEqual(2);
    const firstHunkPatch = hunkToPatch(files[0], files[0].chunks[0]);
    expect(firstHunkPatch).toContain("@@");

    // 3. Stage only the first hunk
    const stageReq = makePost({ action: "stage-hunk", path: repoPath, patch: firstHunkPatch });
    const stageRes = await POST(stageReq);
    expect(stageRes.status).toBe(200);
    const stageData = await stageRes.json();
    expect(stageData.success).toBe(true);

    // 4. Verify: staged diff has first hunk's change, unstaged has second hunk's change
    const git = simpleGit(repoPath);
    const stagedDiff = await git.diff(["--cached", "--", "test.txt"]);
    const unstagedDiff = await git.diff(["--", "test.txt"]);

    expect(stagedDiff).toContain("line1-original");
    expect(stagedDiff).toContain("line1-modified");
    expect(stagedDiff).not.toContain("line15-original");

    expect(unstagedDiff).toContain("line15-original");
    expect(unstagedDiff).toContain("line15-modified");
    expect(unstagedDiff).not.toContain("line1-original");
  });

  it("returns 400 for a patch missing @@ markers", async () => {
    const req = makePost({ action: "stage-hunk", path: repoPath, patch: "not a real patch" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid patch");
  });
});

describe("POST /api/git discard-hunk", () => {
  it("discards the second (unstaged) hunk, restoring line15 to original", async () => {
    // At this point from the previous test: line1 change is staged, line15 is unstaged
    const git = simpleGit(repoPath);

    // Get the unstaged diff (should only have line15 change)
    const unstagedPatch = await git.diff(["--", "test.txt"]);
    expect(unstagedPatch).toContain("line15-original");

    const files = parseUnifiedDiff(unstagedPatch);
    expect(files).toHaveLength(1);
    expect(files[0].chunks.length).toBeGreaterThanOrEqual(1);
    // Find the hunk containing line15
    const hunk15 = files[0].chunks.find((c) =>
      c.changes.some((ch) => ch.content.includes("line15"))
    );
    expect(hunk15).toBeDefined();
    const hunkPatch = hunkToPatch(files[0], hunk15!);

    // Discard the hunk (reverse-apply to working tree)
    const discardReq = makePost({ action: "discard-hunk", path: repoPath, patch: hunkPatch });
    const discardRes = await POST(discardReq);
    expect(discardRes.status).toBe(200);
    const discardData = await discardRes.json();
    expect(discardData.success).toBe(true);

    // Verify working tree now has line15-original (discard reversed the modification)
    const fileContent = fs.readFileSync(path.join(repoPath, "test.txt"), "utf-8");
    expect(fileContent).toContain("line15-original");
    expect(fileContent).not.toContain("line15-modified");

    // staged diff should still have line1 change
    const stagedDiff = await git.diff(["--cached", "--", "test.txt"]);
    expect(stagedDiff).toContain("line1-original");
  });

  it("returns 400 for a patch missing @@ markers", async () => {
    const req = makePost({ action: "discard-hunk", path: repoPath, patch: "garbage" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid patch");
  });
});

// ---------------------------------------------------------------------------
// POST /api/git log-graph — integration test with branch + merge fixture
// ---------------------------------------------------------------------------
let logGraphRepoPath: string;

beforeAll(async () => {
  logGraphRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "tower-git-loggraph-test-"));

  // Helper to run git commands with per-commit timestamps using execFileSync.
  // Distinct timestamps are needed so assertions can rely on finding commits by
  // subject rather than position (git log --all order is not guaranteed).
  const gitExec = (args: string[], extraEnv?: Record<string, string>) =>
    execFileSync("git", args, {
      cwd: logGraphRepoPath,
      env: { ...process.env, ...extraEnv },
      encoding: "utf-8",
    });
  const envA = { GIT_COMMITTER_DATE: "2026-01-01T00:00:01+00:00", GIT_AUTHOR_DATE: "2026-01-01T00:00:01+00:00" };
  const envB = { GIT_COMMITTER_DATE: "2026-01-01T00:00:03+00:00", GIT_AUTHOR_DATE: "2026-01-01T00:00:03+00:00" };
  const envC = { GIT_COMMITTER_DATE: "2026-01-01T00:00:05+00:00", GIT_AUTHOR_DATE: "2026-01-01T00:00:05+00:00" };
  const envD = { GIT_COMMITTER_DATE: "2026-01-01T00:00:07+00:00", GIT_AUTHOR_DATE: "2026-01-01T00:00:07+00:00" };

  gitExec(["init"]);
  gitExec(["config", "user.email", "graph@test.com"]);
  gitExec(["config", "user.name", "GraphTest"]);
  // Force branch name to "main" regardless of git config default
  gitExec(["symbolic-ref", "HEAD", "refs/heads/main"]);

  // Commit A on main
  fs.writeFileSync(path.join(logGraphRepoPath, "a.txt"), "commit-a\n");
  gitExec(["add", "a.txt"]);
  gitExec(["commit", "-m", "Commit A"], envA);

  // Create feat branch, commit B
  gitExec(["checkout", "-b", "feat"]);
  fs.writeFileSync(path.join(logGraphRepoPath, "b.txt"), "commit-b\n");
  gitExec(["add", "b.txt"]);
  gitExec(["commit", "-m", "Commit B"], envB);

  // Back to main, commit C
  gitExec(["checkout", "main"]);
  fs.writeFileSync(path.join(logGraphRepoPath, "c.txt"), "commit-c\n");
  gitExec(["add", "c.txt"]);
  gitExec(["commit", "-m", "Commit C"], envC);

  // Merge feat → main with --no-ff to force a merge commit D (2 parents)
  gitExec(["merge", "feat", "--no-ff", "-m", "Merge feat into main"], envD);
});

afterAll(() => {
  if (logGraphRepoPath && fs.existsSync(logGraphRepoPath)) {
    fs.rmSync(logGraphRepoPath, { recursive: true, force: true });
  }
});

describe("POST /api/git log-graph", () => {
  it("returns 4 commits with correct shapes (A, B, C, D)", async () => {
    const req = makePost({ action: "log-graph", path: logGraphRepoPath });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data.commits)).toBe(true);
    expect(data.commits.length).toBe(4);

    for (const c of data.commits) {
      expect(typeof c.hash).toBe("string");
      expect(c.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(typeof c.shortHash).toBe("string");
      expect(c.shortHash.length).toBe(7);
      expect(c.shortHash).toBe(c.hash.slice(0, 7));
      expect(Array.isArray(c.parents)).toBe(true);
      expect(typeof c.author).toBe("string");
      expect(c.author.length).toBeGreaterThan(0);
      expect(typeof c.date).toBe("string");
      expect(typeof c.subject).toBe("string");
      expect(Array.isArray(c.refs)).toBe(true);
    }
  });

  it("merge commit D has exactly 2 parents", async () => {
    const req = makePost({ action: "log-graph", path: logGraphRepoPath });
    const res = await POST(req);
    const data = await res.json();

    // Find the merge commit by subject (order is not guaranteed with --all)
    const mergeCommit = data.commits.find((c: { subject: string }) => c.subject.includes("Merge feat"));
    expect(mergeCommit).toBeDefined();
    expect(mergeCommit.parents.length).toBe(2);
    // Each parent SHA should be a full 40-char hex
    for (const parent of mergeCommit.parents) {
      expect(parent).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it("root commit A has 0 parents", async () => {
    const req = makePost({ action: "log-graph", path: logGraphRepoPath });
    const res = await POST(req);
    const data = await res.json();

    // Find the root commit by subject
    const rootCommit = data.commits.find((c: { subject: string }) => c.subject === "Commit A");
    expect(rootCommit).toBeDefined();
    expect(rootCommit.parents.length).toBe(0);
  });

  it("head is a valid SHA and matches HEAD in the commits list", async () => {
    const req = makePost({ action: "log-graph", path: logGraphRepoPath });
    const res = await POST(req);
    const data = await res.json();

    expect(typeof data.head).toBe("string");
    expect(data.head).toMatch(/^[0-9a-f]{40}$/);
    // HEAD should point to one of the returned commits
    const headCommit = data.commits.find((c: { hash: string }) => c.hash === data.head);
    expect(headCommit).toBeDefined();
    // HEAD is currently on main after the merge — that's the merge commit
    expect(headCommit.subject).toContain("Merge feat");
  });

  it("respects limit parameter", async () => {
    const req = makePost({ action: "log-graph", path: logGraphRepoPath, limit: "2" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.commits.length).toBe(2);
  });

  it("returns 400 when path is missing", async () => {
    const req = makePost({ action: "log-graph" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/git show-commit — integration test with a 2-file commit fixture
// ---------------------------------------------------------------------------
let showCommitRepoPath: string;
let showCommitHash: string;

beforeAll(async () => {
  showCommitRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "tower-git-showcommit-test-"));

  const gitExec = (args: string[], extraEnv?: Record<string, string>) =>
    execFileSync("git", args, {
      cwd: showCommitRepoPath,
      env: { ...process.env, ...extraEnv },
      encoding: "utf-8",
    });

  const envA = { GIT_COMMITTER_DATE: "2026-01-01T00:00:01+00:00", GIT_AUTHOR_DATE: "2026-01-01T00:00:01+00:00" };
  const envB = { GIT_COMMITTER_DATE: "2026-01-01T00:00:03+00:00", GIT_AUTHOR_DATE: "2026-01-01T00:00:03+00:00" };

  gitExec(["init"]);
  gitExec(["config", "user.email", "show@test.com"]);
  gitExec(["config", "user.name", "ShowTest"]);
  gitExec(["symbolic-ref", "HEAD", "refs/heads/main"]);

  // Initial commit: only a.txt
  fs.writeFileSync(path.join(showCommitRepoPath, "a.txt"), "hello from a\n");
  gitExec(["add", "a.txt"]);
  gitExec(["commit", "-m", "Initial commit"], envA);

  // Second commit: modify a.txt AND create b.txt — 2 files changed (M + A cases)
  fs.writeFileSync(path.join(showCommitRepoPath, "a.txt"), "hello from a\nline added to a\n");
  fs.writeFileSync(path.join(showCommitRepoPath, "b.txt"), "hello from b\n");
  gitExec(["add", "a.txt", "b.txt"]);
  gitExec(["commit", "-m", "Add b.txt and modify a.txt"], envB);

  // Capture the second commit hash for tests
  showCommitHash = gitExec(["rev-parse", "HEAD"]).trim();
});

afterAll(() => {
  if (showCommitRepoPath && fs.existsSync(showCommitRepoPath)) {
    fs.rmSync(showCommitRepoPath, { recursive: true, force: true });
  }
});

describe("POST /api/git show-commit", () => {
  it("happy path: returns patch and 2-file breakdown for a multi-file commit", async () => {
    const req = makePost({ action: "show-commit", path: showCommitRepoPath, hash: showCommitHash });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    // patch is a non-empty string containing diff --git markers for both files
    expect(typeof data.patch).toBe("string");
    expect(data.patch).toContain("diff --git");
    expect(data.patch).toContain("a.txt");
    expect(data.patch).toContain("b.txt");

    // files array has exactly 2 entries
    expect(Array.isArray(data.files)).toBe(true);
    expect(data.files.length).toBe(2);

    // Each file has the expected shape
    for (const f of data.files) {
      expect(typeof f.filename).toBe("string");
      expect(f.filename.length).toBeGreaterThan(0);
      expect(typeof f.added).toBe("number");
      expect(typeof f.removed).toBe("number");
      expect(typeof f.isBinary).toBe("boolean");
      // files[].patch is intentionally empty per spec
      expect(f.patch).toBe("");
    }

    // Verify specific filenames and add/remove counts
    const aFile = data.files.find((f: { filename: string }) => f.filename === "a.txt");
    const bFile = data.files.find((f: { filename: string }) => f.filename === "b.txt");
    expect(aFile).toBeDefined();
    expect(bFile).toBeDefined();

    // a.txt had 1 line added (existing file, one new line appended)
    expect(aFile.added).toBe(1);
    expect(aFile.removed).toBe(0);

    // b.txt is newly created: 1 line added
    expect(bFile.added).toBe(1);
    expect(bFile.removed).toBe(0);
  });

  it("invalid hash format → 400 with error: 'invalid commit hash'", async () => {
    const req = makePost({ action: "show-commit", path: showCommitRepoPath, hash: "not-hex" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid commit hash");
  });

  it("invalid hash: too short (3 chars) → 400", async () => {
    const req = makePost({ action: "show-commit", path: showCommitRepoPath, hash: "abc" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid commit hash");
  });

  it("non-existent well-formed hash → 404 with error: 'commit not found or unreadable'", async () => {
    const req = makePost({ action: "show-commit", path: showCommitRepoPath, hash: "0000000" });
    const res = await POST(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("commit not found or unreadable");
  });
});

// ---------------------------------------------------------------------------
// parseBlamePorcelain unit tests (fixture-based, no real git needed)
// ---------------------------------------------------------------------------
describe("parseBlamePorcelain — unit", () => {
  // Minimal two-line porcelain fixture: two different shas, metadata for each
  const FIXTURE = [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1",
    "author Alice",
    "author-mail <alice@example.com>",
    "author-time 1700000000",
    "author-tz +0800",
    "committer Alice",
    "committer-mail <alice@example.com>",
    "committer-time 1700000000",
    "committer-tz +0800",
    "summary First commit",
    "filename foo.ts",
    "\tconst x = 1;",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2 1",
    "author Bob",
    "author-mail <bob@example.com>",
    "author-time 1700086400",
    "author-tz +0800",
    "committer Bob",
    "committer-mail <bob@example.com>",
    "committer-time 1700086400",
    "committer-tz +0800",
    "summary Second commit",
    "filename foo.ts",
    "\tconst y = 2;",
  ].join("\n");

  it("parses two distinct shas with correct line numbers", () => {
    const lines = parseBlamePorcelain(FIXTURE);
    expect(lines).toHaveLength(2);
    expect(lines[0].sha).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(lines[0].line).toBe(1);
    expect(lines[1].sha).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(lines[1].line).toBe(2);
  });

  it("extracts correct author names", () => {
    const lines = parseBlamePorcelain(FIXTURE);
    expect(lines[0].author).toBe("Alice");
    expect(lines[1].author).toBe("Bob");
  });

  it("extracts correct summary strings", () => {
    const lines = parseBlamePorcelain(FIXTURE);
    expect(lines[0].summary).toBe("First commit");
    expect(lines[1].summary).toBe("Second commit");
  });

  it("parses author-time as an ISO date string", () => {
    const lines = parseBlamePorcelain(FIXTURE);
    // 1700000000 → 2023-11-14T…
    expect(lines[0].date).toBeDefined();
    expect(lines[0].date).toContain("2023");
  });

  it("returns empty array for empty input", () => {
    const lines = parseBlamePorcelain("");
    expect(lines).toEqual([]);
  });

  it("re-uses cached metadata for repeated sha", () => {
    // Same sha appearing on two lines — second occurrence has no metadata headers
    const repeated = [
      "cccccccccccccccccccccccccccccccccccccccc 1 1 2",
      "author Charlie",
      "author-mail <charlie@example.com>",
      "author-time 1700000000",
      "author-tz +0800",
      "committer Charlie",
      "committer-mail <charlie@example.com>",
      "committer-time 1700000000",
      "committer-tz +0800",
      "summary Cached commit",
      "filename bar.ts",
      "\tline one",
      "cccccccccccccccccccccccccccccccccccccccc 2 2",
      "\tline two",
    ].join("\n");

    const lines = parseBlamePorcelain(repeated);
    expect(lines).toHaveLength(2);
    expect(lines[0].author).toBe("Charlie");
    expect(lines[1].author).toBe("Charlie");
    expect(lines[1].summary).toBe("Cached commit");
  });
});

// ---------------------------------------------------------------------------
// POST /api/git blame — integration test using real temp repo
// ---------------------------------------------------------------------------
let blameRepoPath: string;

beforeAll(async () => {
  blameRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "tower-git-blame-test-"));
  const git = simpleGit(blameRepoPath);
  await git.init();
  await git.addConfig("user.email", "blame@test.com");
  await git.addConfig("user.name", "BlameTest");

  // First commit: file with 3 lines
  fs.writeFileSync(path.join(blameRepoPath, "blame.txt"), "line1\nline2\nline3\n");
  await git.add("blame.txt");
  await git.commit("Initial blame commit");

  // Second commit: change line2 only
  fs.writeFileSync(path.join(blameRepoPath, "blame.txt"), "line1\nline2-modified\nline3\n");
  await git.add("blame.txt");
  await git.commit("Second blame commit");
});

afterAll(() => {
  if (blameRepoPath && fs.existsSync(blameRepoPath)) {
    fs.rmSync(blameRepoPath, { recursive: true, force: true });
  }
});

describe("POST /api/git blame", () => {
  it("returns blame lines with sha, author, and line numbers", async () => {
    const req = makePost({ action: "blame", path: blameRepoPath, file: "blame.txt" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.lines)).toBe(true);
    expect(data.lines.length).toBe(3);

    const first = data.lines[0];
    expect(typeof first.sha).toBe("string");
    expect(first.sha.length).toBe(40);
    expect(typeof first.author).toBe("string");
    expect(typeof first.line).toBe("number");
  });

  it("returns two distinct shas — line2 was changed in second commit", async () => {
    const req = makePost({ action: "blame", path: blameRepoPath, file: "blame.txt" });
    const res = await POST(req);
    const { lines } = await res.json() as { lines: { sha: string; line: number }[] };

    const line1Sha = lines.find((l) => l.line === 1)?.sha;
    const line2Sha = lines.find((l) => l.line === 2)?.sha;
    const line3Sha = lines.find((l) => l.line === 3)?.sha;

    expect(line1Sha).toBeDefined();
    expect(line2Sha).toBeDefined();
    expect(line3Sha).toBeDefined();

    // line1 and line3 were NOT changed — same sha as initial commit
    expect(line1Sha).toBe(line3Sha);
    // line2 was changed — different sha
    expect(line2Sha).not.toBe(line1Sha);
  });

  it("returns empty lines for a non-existent file", async () => {
    const req = makePost({ action: "blame", path: blameRepoPath, file: "nonexistent.txt" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lines).toEqual([]);
  });

  it("returns 500 for an invalid (absolute) file path", async () => {
    const req = makePost({ action: "blame", path: blameRepoPath, file: "/etc/passwd" });
    const res = await POST(req);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/git commit-ops — checkout / reset / tag / cherry-pick / revert / amend
// ---------------------------------------------------------------------------

let commitOpsRepoPath: string;
let firstCommitHash: string;
let secondCommitHash: string;

// Helper to build a fresh 2-commit repo for each test (bulletproof isolation)
async function buildCommitOpsFixture(dir: string) {
  const gitExec = (args: string[], extraEnv?: Record<string, string>) =>
    execFileSync("git", args, {
      cwd: dir,
      env: { ...process.env, ...extraEnv },
      encoding: "utf-8",
    });

  const envA = { GIT_COMMITTER_DATE: "2026-01-01T00:00:01+00:00", GIT_AUTHOR_DATE: "2026-01-01T00:00:01+00:00" };
  const envB = { GIT_COMMITTER_DATE: "2026-01-01T00:00:03+00:00", GIT_AUTHOR_DATE: "2026-01-01T00:00:03+00:00" };

  gitExec(["init"]);
  gitExec(["config", "user.email", "ops@test.com"]);
  gitExec(["config", "user.name", "OpsTest"]);
  gitExec(["symbolic-ref", "HEAD", "refs/heads/main"]);

  // First commit
  fs.writeFileSync(path.join(dir, "a.txt"), "first\n");
  gitExec(["add", "a.txt"]);
  gitExec(["commit", "-m", "First commit"], envA);
  const first = gitExec(["rev-parse", "HEAD"]).trim();

  // Second commit
  fs.writeFileSync(path.join(dir, "a.txt"), "second\n");
  gitExec(["add", "a.txt"]);
  gitExec(["commit", "-m", "Second commit"], envB);
  const second = gitExec(["rev-parse", "HEAD"]).trim();

  return { first, second };
}

beforeEach(async () => {
  commitOpsRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "tower-git-commitops-"));
  const hashes = await buildCommitOpsFixture(commitOpsRepoPath);
  firstCommitHash = hashes.first;
  secondCommitHash = hashes.second;
});

afterEach(() => {
  if (commitOpsRepoPath && fs.existsSync(commitOpsRepoPath)) {
    fs.rmSync(commitOpsRepoPath, { recursive: true, force: true });
  }
});

describe("POST /api/git commit-ops", () => {
  // --- checkout-commit ---
  it("checkout-commit: HEAD moves to first commit (detached)", async () => {
    const req = makePost({ action: "checkout-commit", path: commitOpsRepoPath, hash: firstCommitHash });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    const git = simpleGit(commitOpsRepoPath);
    const head = (await git.revparse(["HEAD"])).trim();
    expect(head).toBe(firstCommitHash);
  });

  it("checkout-commit invalid hash → 400", async () => {
    const req = makePost({ action: "checkout-commit", path: commitOpsRepoPath, hash: "zzz" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid commit hash");
  });

  // --- reset-commit ---
  it("reset-commit soft: HEAD at first commit, second commit's changes still staged", async () => {
    const req = makePost({ action: "reset-commit", path: commitOpsRepoPath, hash: firstCommitHash, mode: "soft" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.mode).toBe("soft");

    const git = simpleGit(commitOpsRepoPath);
    const head = (await git.revparse(["HEAD"])).trim();
    expect(head).toBe(firstCommitHash);

    // Staged diff should show the second commit's changes (a.txt: first → second)
    const staged = await git.diff(["--cached"]);
    expect(staged).toContain("second");
  });

  it("reset-commit mixed: HEAD at first commit, staged area reset, working tree intact", async () => {
    const req = makePost({ action: "reset-commit", path: commitOpsRepoPath, hash: firstCommitHash, mode: "mixed" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.mode).toBe("mixed");

    const git = simpleGit(commitOpsRepoPath);
    const head = (await git.revparse(["HEAD"])).trim();
    expect(head).toBe(firstCommitHash);

    // After mixed reset: staged area is clean (no staged diff), but working tree has "second"
    const staged = await git.diff(["--cached"]);
    expect(staged).toBe("");

    const working = await git.diff([]);
    expect(working).toContain("second");
  });

  it("reset-commit defaults to mixed when mode is omitted", async () => {
    const req = makePost({ action: "reset-commit", path: commitOpsRepoPath, hash: firstCommitHash });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mode).toBe("mixed");
  });

  it("reset-commit invalid hash → 400", async () => {
    const req = makePost({ action: "reset-commit", path: commitOpsRepoPath, hash: "zzz" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // --- create-tag ---
  it("create-tag: lightweight tag appears in git.tags()", async () => {
    const req = makePost({ action: "create-tag", path: commitOpsRepoPath, hash: secondCommitHash, name: "v1.0" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.name).toBe("v1.0");

    const git = simpleGit(commitOpsRepoPath);
    const tags = await git.tags();
    expect(tags.all).toContain("v1.0");
  });

  it("create-tag sanitization: 'v1.0;rm-rf' → sanitized name used", async () => {
    const req = makePost({ action: "create-tag", path: commitOpsRepoPath, hash: secondCommitHash, name: "v1.0;rm-rf" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    // The semicolon is stripped, resulting in "v1.0rm-rf"
    expect(data.name).toBe("v1.0rm-rf");

    const git = simpleGit(commitOpsRepoPath);
    const tags = await git.tags();
    expect(tags.all).toContain("v1.0rm-rf");
  });

  it("create-tag empty name → 400", async () => {
    const req = makePost({ action: "create-tag", path: commitOpsRepoPath, hash: secondCommitHash, name: "  " });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("tag name required");
  });

  it("create-tag invalid hash → 400", async () => {
    const req = makePost({ action: "create-tag", path: commitOpsRepoPath, hash: "zzz", name: "v2.0" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid commit hash");
  });

  // --- cherry-pick ---
  it("cherry-pick: creates a new commit from a different branch commit", async () => {
    // Create a third commit on a side branch, then cherry-pick it onto main
    const gitExec = (args: string[], extraEnv?: Record<string, string>) =>
      execFileSync("git", args, {
        cwd: commitOpsRepoPath,
        env: { ...process.env, ...extraEnv },
        encoding: "utf-8",
      });

    const envC = { GIT_COMMITTER_DATE: "2026-01-01T00:00:05+00:00", GIT_AUTHOR_DATE: "2026-01-01T00:00:05+00:00" };

    // Create side branch from first commit and add a new file
    gitExec(["checkout", "-b", "side", firstCommitHash]);
    fs.writeFileSync(path.join(commitOpsRepoPath, "cherry.txt"), "cherry content\n");
    gitExec(["add", "cherry.txt"]);
    gitExec(["commit", "-m", "Cherry commit"], envC);
    const cherryHash = gitExec(["rev-parse", "HEAD"]).trim();

    // Go back to main
    gitExec(["checkout", "main"]);

    const countBefore = parseInt(gitExec(["rev-list", "--count", "HEAD"]).trim(), 10);

    // Cherry-pick the side branch commit onto main
    const req = makePost({ action: "cherry-pick", path: commitOpsRepoPath, hash: cherryHash });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Verify commit count increased
    const countAfter = parseInt(gitExec(["rev-list", "--count", "HEAD"]).trim(), 10);
    expect(countAfter).toBe(countBefore + 1);

    // The cherry-picked file should now exist on main
    expect(fs.existsSync(path.join(commitOpsRepoPath, "cherry.txt"))).toBe(true);
  });

  it("cherry-pick invalid hash → 400", async () => {
    const req = makePost({ action: "cherry-pick", path: commitOpsRepoPath, hash: "zzz" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid commit hash");
  });

  // --- revert ---
  it("revert: creates a new 'Revert' commit reversing the second commit", async () => {
    const gitExec = (args: string[]) =>
      execFileSync("git", args, {
        cwd: commitOpsRepoPath,
        env: { ...process.env },
        encoding: "utf-8",
      });

    const countBefore = parseInt(gitExec(["rev-list", "--count", "HEAD"]).trim(), 10);

    const req = makePost({ action: "revert", path: commitOpsRepoPath, hash: secondCommitHash });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // A new "Revert ..." commit should have been created
    const countAfter = parseInt(gitExec(["rev-list", "--count", "HEAD"]).trim(), 10);
    expect(countAfter).toBe(countBefore + 1);

    // The latest commit subject should start with "Revert"
    const git = simpleGit(commitOpsRepoPath);
    const log = await git.log(["-1"]);
    expect(log.latest?.message).toContain("Revert");
  });

  it("revert invalid hash → 400", async () => {
    const req = makePost({ action: "revert", path: commitOpsRepoPath, hash: "zzz" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid commit hash");
  });

  // --- amend-message ---
  it("amend-message: HEAD commit message updated", async () => {
    const newMessage = "Amended: improved second commit message";
    const req = makePost({ action: "amend-message", path: commitOpsRepoPath, message: newMessage });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    const git = simpleGit(commitOpsRepoPath);
    const log = await git.log(["-1"]);
    expect(log.latest?.message).toBe(newMessage);

    // The commit hash should change after amend (different commit object)
    const head = (await git.revparse(["HEAD"])).trim();
    expect(head).not.toBe(secondCommitHash);
  });

  it("amend-message empty message → 400", async () => {
    const req = makePost({ action: "amend-message", path: commitOpsRepoPath, message: "   " });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("message required");
  });
});
