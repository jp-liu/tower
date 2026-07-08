import { describe, it, expect } from "vitest";
import { parseStatusLine } from "../mission-complete-commit-dialog";

describe("parseStatusLine", () => {
  it("parses a modified file", () => {
    expect(parseStatusLine("M src/app/page.tsx")).toEqual({ status: "M", path: "src/app/page.tsx" });
  });

  it("parses an untracked file", () => {
    expect(parseStatusLine("?? components.d.ts")).toEqual({ status: "??", path: "components.d.ts" });
  });

  it("resolves a rename to the new path", () => {
    expect(parseStatusLine("R  old/a.ts -> new/b.ts")).toEqual({ status: "R", path: "new/b.ts" });
  });
});
