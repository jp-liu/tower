import { describe, it, expect } from "vitest";
import { parseDiffOutput } from "../diff-parser";

// ── Helpers ──

function makeNumstatLine(added: number | string, removed: number | string, filename: string) {
  return `${added}\t${removed}\t${filename}`;
}

function makeUnifiedHeader(filename: string) {
  return `diff --git a/${filename} b/${filename}\nindex abc1234..def5678 100644\n--- a/${filename}\n+++ b/${filename}`;
}

function makeHunk(contextLine: string, addedLine: string, removedLine: string) {
  return `@@ -1,3 +1,3 @@\n ${contextLine}\n+${addedLine}\n-${removedLine}`;
}

// ── Tests ──

describe("parseDiffOutput — empty inputs", () => {
  it("returns empty result for empty numstat and unified diff", () => {
    const result = parseDiffOutput("", "");
    expect(result.files).toEqual([]);
    expect(result.totalAdded).toBe(0);
    expect(result.totalRemoved).toBe(0);
  });

  it("returns empty result for whitespace-only inputs", () => {
    const result = parseDiffOutput("   \n\t  ", "  \n  ");
    expect(result.files).toEqual([]);
    expect(result.totalAdded).toBe(0);
    expect(result.totalRemoved).toBe(0);
  });
});

describe("parseDiffOutput — standard diff (adds and removes)", () => {
  it("parses single file with adds and removes", () => {
    const numstat = makeNumstatLine(10, 5, "src/app.ts");
    const unified =
      makeUnifiedHeader("src/app.ts") +
      "\n" +
      makeHunk("existing line", "new feature line", "old line") +
      "\n";

    const result = parseDiffOutput(numstat, unified);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe("src/app.ts");
    expect(result.files[0].added).toBe(10);
    expect(result.files[0].removed).toBe(5);
    expect(result.files[0].isBinary).toBe(false);
    expect(result.files[0].patch).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(result.totalAdded).toBe(10);
    expect(result.totalRemoved).toBe(5);
  });

  it("parses multiple files and sums totals correctly", () => {
    const numstat = [
      makeNumstatLine(3, 1, "src/a.ts"),
      makeNumstatLine(7, 2, "src/b.ts"),
    ].join("\n");

    const unified =
      makeUnifiedHeader("src/a.ts") + "\n" + makeHunk("ctx", "add a", "rm a") + "\n" +
      makeUnifiedHeader("src/b.ts") + "\n" + makeHunk("ctx", "add b", "rm b") + "\n";

    const result = parseDiffOutput(numstat, unified);

    expect(result.files).toHaveLength(2);
    expect(result.totalAdded).toBe(10); // 3 + 7
    expect(result.totalRemoved).toBe(3); // 1 + 2
  });
});

describe("parseDiffOutput — added-only hunk", () => {
  it("returns totalRemoved=0 when only lines added", () => {
    const numstat = makeNumstatLine(5, 0, "src/new-file.ts");
    const unified =
      `diff --git a/src/new-file.ts b/src/new-file.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/new-file.ts\n` +
      `@@ -0,0 +1,5 @@\n+line 1\n+line 2\n+line 3\n+line 4\n+line 5\n`;

    const result = parseDiffOutput(numstat, unified);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].added).toBe(5);
    expect(result.files[0].removed).toBe(0);
    expect(result.totalAdded).toBe(5);
    expect(result.totalRemoved).toBe(0);
  });
});

describe("parseDiffOutput — removed-only hunk", () => {
  it("returns totalAdded=0 when only lines removed", () => {
    const numstat = makeNumstatLine(0, 8, "src/old-file.ts");
    const unified =
      makeUnifiedHeader("src/old-file.ts") +
      "\n@@ -1,8 +0,0 @@\n-line 1\n-line 2\n-line 3\n-line 4\n-line 5\n-line 6\n-line 7\n-line 8\n";

    const result = parseDiffOutput(numstat, unified);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].added).toBe(0);
    expect(result.files[0].removed).toBe(8);
    expect(result.totalAdded).toBe(0);
    expect(result.totalRemoved).toBe(8);
  });
});

describe("parseDiffOutput — binary files", () => {
  it("marks binary file with isBinary=true and added=removed=0", () => {
    const numstat = makeNumstatLine("-", "-", "assets/logo.png");
    // Binary files typically don't produce unified diff output
    const unified = "";

    const result = parseDiffOutput(numstat, unified);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe("assets/logo.png");
    expect(result.files[0].isBinary).toBe(true);
    expect(result.files[0].added).toBe(0);
    expect(result.files[0].removed).toBe(0);
  });

  it("does not include binary file in totalAdded/totalRemoved", () => {
    const numstat = [
      makeNumstatLine("-", "-", "assets/logo.png"),
      makeNumstatLine(3, 1, "src/code.ts"),
    ].join("\n");
    const unified = makeUnifiedHeader("src/code.ts") + "\n" + makeHunk("ctx", "add", "rm") + "\n";

    const result = parseDiffOutput(numstat, unified);

    expect(result.totalAdded).toBe(3);
    expect(result.totalRemoved).toBe(1);
  });
});

describe("parseDiffOutput — numstat with no matching unified diff segment", () => {
  it("returns empty patch string when file not in unified diff", () => {
    const numstat = makeNumstatLine(5, 2, "src/missing.ts");
    const unified = ""; // No unified diff content

    const result = parseDiffOutput(numstat, unified);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].patch).toBe("");
    expect(result.files[0].added).toBe(5);
    expect(result.files[0].removed).toBe(2);
  });
});

describe("parseDiffOutput — truncation at >500KB", () => {
  it("truncates patch to 200 lines and appends truncation marker", () => {
    const filename = "src/large-file.ts";
    const numstat = makeNumstatLine(500, 0, filename);

    // Build a unified diff larger than 500KB
    const headerLines = makeUnifiedHeader(filename);
    const hunkLines = Array.from({ length: 500 }, (_, i) => `+added line ${i}`).join("\n");
    const diffContent = `${headerLines}\n@@ -0,0 +1,500 @@\n${hunkLines}\n`;

    // Pad to exceed 500KB
    const padding = "// padding\n".repeat(Math.ceil((500 * 1024) / 11));
    const paddedDiff = `${diffContent}${makeUnifiedHeader("src/pad.ts")}\n${padding}`;

    const paddedNumstat = `${numstat}\n${makeNumstatLine(0, 0, "src/pad.ts")}`;

    const result = parseDiffOutput(paddedNumstat, paddedDiff);

    // Large file's patch should be truncated
    const largePatch = result.files.find((f) => f.filename === filename);
    expect(largePatch).toBeDefined();
    const patchLines = largePatch!.patch.split("\n");
    // After truncation: at most 200 lines content + 1 truncation line
    expect(patchLines.length).toBeLessThanOrEqual(201);
    expect(largePatch!.patch).toContain("... (truncated)");
  });

  it("does NOT truncate patches when total diff is under 500KB", () => {
    const filename = "src/small-file.ts";
    const numstat = makeNumstatLine(3, 1, filename);
    const unified =
      makeUnifiedHeader(filename) +
      "\n" +
      makeHunk("ctx", "add line", "remove line") +
      "\n";

    const result = parseDiffOutput(numstat, unified);

    expect(result.files[0].patch).not.toContain("... (truncated)");
  });
});

describe("parseDiffOutput — malformed numstat lines", () => {
  it("skips lines with fewer than 3 tab-separated parts", () => {
    const numstat = "bad line\n5\t3\tsrc/valid.ts";
    const unified = makeUnifiedHeader("src/valid.ts") + "\n" + makeHunk("ctx", "add", "rm") + "\n";

    const result = parseDiffOutput(numstat, unified);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].filename).toBe("src/valid.ts");
  });

  it("treats non-numeric added/removed as 0", () => {
    // "xyz" parsed as parseInt → 0
    const numstat = "xyz\tabc\tsrc/weird.ts";
    const result = parseDiffOutput(numstat, "");
    expect(result.files[0].added).toBe(0);
    expect(result.files[0].removed).toBe(0);
  });
});
