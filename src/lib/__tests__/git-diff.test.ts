import { describe, it, expect } from "vitest";
import { parseUnifiedDiff, hunkToPatch } from "../git-diff";

describe("parseUnifiedDiff", () => {
  it("returns one file with one hunk for a simple modify", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      "-a",
      "+b",
      " c",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(patch);
    expect(files).toHaveLength(1);
    expect(files[0].to).toBe("x.ts");
    expect(files[0].chunks).toHaveLength(1);
  });

  it("normalizes CRLF before parsing", () => {
    const patch = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\r\n");
    const files = parseUnifiedDiff(patch);
    expect(files).toHaveLength(1);
  });
});

describe("hunkToPatch", () => {
  it("rebuilds a single-hunk patch with diff/--- /+++ headers and @@ marker", () => {
    const original = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      "-a",
      "+b",
      " c",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(original);
    const patch = hunkToPatch(files[0], files[0].chunks[0]);
    const expected = [
      "diff --git a/x.ts b/x.ts",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      "-a",
      "+b",
      " c",
      "",
    ].join("\n");
    expect(patch).toEqual(expected);
  });

  it("produces /dev/null for new file --- side and uses surviving path in diff --git", () => {
    const original = [
      "diff --git a/new.ts b/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1 @@",
      "+hello",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(original);
    const patch = hunkToPatch(files[0], files[0].chunks[0]);
    const expected = [
      "diff --git a/new.ts b/new.ts",
      "--- /dev/null",
      "+++ b/new.ts",
      "@@ -0,0 +1 @@",
      "+hello",
      "",
    ].join("\n");
    expect(patch).toEqual(expected);
    expect(patch).toContain("--- /dev/null");
    expect(patch).not.toContain("a//dev/null");
  });

  it("produces /dev/null for deleted file +++ side and uses surviving path in diff --git", () => {
    const original = [
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(original);
    const patch = hunkToPatch(files[0], files[0].chunks[0]);
    const expected = [
      "diff --git a/old.ts b/old.ts",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-bye",
      "",
    ].join("\n");
    expect(patch).toEqual(expected);
    expect(patch).toContain("+++ /dev/null");
    expect(patch).not.toContain("b//dev/null");
  });
});
