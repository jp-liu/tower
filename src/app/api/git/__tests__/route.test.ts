// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
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
