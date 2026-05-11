// @vitest-environment node
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import simpleGit from "simple-git";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { parseUnifiedDiff, hunkToPatch } from "@/lib/git-diff";

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
