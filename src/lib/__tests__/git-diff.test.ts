import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../git-diff";

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
