import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted required for child_process mock in jsdom vitest environment
// (Phase 62 decision: mock factory runs before const declarations)
const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
}));

import { searchCode } from "@/actions/search-code-actions";

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper: build a valid rg JSON match line
function makeRgMatchLine(
  absolutePath: string,
  lineNumber: number,
  lineText: string,
  matchText: string,
  start: number,
  end: number
): string {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: absolutePath },
      lines: { text: lineText },
      line_number: lineNumber,
      absolute_offset: 0,
      submatches: [{ match: { text: matchText }, start, end }],
    },
  });
}

// ---------------------------------------------------------------------------
// Test 1 (SEARCH-02): rg exit 0 → returns matches array with SearchMatch objects
// ---------------------------------------------------------------------------
describe("Test 1: rg exit 0 returns matches", () => {
  it("returns non-empty matches array, no error", async () => {
    const rgOutput = [
      makeRgMatchLine("/project/src/foo.ts", 42, '  const hello = "world";\n', "hello", 8, 13),
      // summary line — should be ignored
      JSON.stringify({ type: "summary", data: {} }),
    ].join("\n");

    // First call is "which rg" — succeeds
    mockExecFileSync.mockReturnValueOnce("/usr/bin/rg\n");
    // Second call is the actual rg search
    mockExecFileSync.mockReturnValueOnce(rgOutput);

    const result = await searchCode("/project", "hello");

    expect(result.error).toBeUndefined();
    expect(result.matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2 (SEARCH-02): rg exit 1 (no matches) → returns empty matches, truncated=false, no error
// ---------------------------------------------------------------------------
describe("Test 2: rg exit 1 returns empty matches", () => {
  it("exit code 1 returns empty matches array without error", async () => {
    // First call: "which rg" succeeds
    mockExecFileSync.mockReturnValueOnce("/usr/bin/rg\n");
    // Second call: rg exits with code 1 (no matches)
    mockExecFileSync.mockImplementationOnce(() => {
      const err = new Error("Command failed") as Error & { status: number };
      err.status = 1;
      throw err;
    });

    const result = await searchCode("/project", "nomatch_xyz");

    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 3 (SEARCH-02): rg exit 2+ (error) → returns error string
// ---------------------------------------------------------------------------
describe("Test 3: rg exit 2+ returns error string", () => {
  it("exit code 2 returns error string", async () => {
    // First call: "which rg" succeeds
    mockExecFileSync.mockReturnValueOnce("/usr/bin/rg\n");
    // Second call: rg exits with code 2 (real error)
    mockExecFileSync.mockImplementationOnce(() => {
      const err = new Error("rg error") as Error & { status: number };
      err.status = 2;
      throw err;
    });

    const result = await searchCode("/project", "pattern");

    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Test 4 (SEARCH-02): rg not installed → returns error string mentioning ripgrep
// ---------------------------------------------------------------------------
describe("Test 4: rg not installed returns error string", () => {
  it("returns error including 'ripgrep' when which check throws", async () => {
    // First call: "which rg" fails (rg not found)
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("which: no rg in PATH");
    });

    const result = await searchCode("/project", "pattern");

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/ripgrep|rg.*not installed/i);
  });
});

// ---------------------------------------------------------------------------
// Test 5 (SEARCH-03): glob filter → --glob arg is passed to execFileSync
// ---------------------------------------------------------------------------
describe("Test 5: glob filter passes --glob arg", () => {
  it("passes --glob and the glob value to rg args", async () => {
    const rgOutput = makeRgMatchLine("/project/src/foo.ts", 1, "hello world\n", "hello", 0, 5);

    mockExecFileSync.mockReturnValueOnce("/usr/bin/rg\n"); // which rg
    mockExecFileSync.mockReturnValueOnce(rgOutput);        // rg search

    await searchCode("/project", "hello", "*.ts");

    // Second call to mockExecFileSync is the rg invocation
    const calls = mockExecFileSync.mock.calls;
    const rgCall = calls.find((c) => c[0] === "rg");
    expect(rgCall).toBeDefined();
    const args = rgCall![1] as string[];
    expect(args).toContain("--glob");
    expect(args).toContain("*.ts");
  });
});

// ---------------------------------------------------------------------------
// Test 6 (SEARCH-04): result parsing → filePath is relative
// ---------------------------------------------------------------------------
describe("Test 6: filePath is relative (strips localPath prefix)", () => {
  it("strips localPath prefix from match absolute path", async () => {
    const rgOutput = makeRgMatchLine(
      "/project/src/foo.ts",
      42,
      '  const hello = "world";\n',
      "hello",
      8,
      13
    );

    mockExecFileSync.mockReturnValueOnce("/usr/bin/rg\n");
    mockExecFileSync.mockReturnValueOnce(rgOutput);

    const result = await searchCode("/project", "hello");

    expect(result.matches[0].filePath).toBe("src/foo.ts");
  });
});

// ---------------------------------------------------------------------------
// Test 7 (SEARCH-04): result contains lineNumber, lineText, submatches
// ---------------------------------------------------------------------------
describe("Test 7: result contains lineNumber, lineText, submatches", () => {
  it("match object has correct fields with start/end", async () => {
    const rgOutput = makeRgMatchLine(
      "/project/src/foo.ts",
      42,
      '  const hello = "world";\n',
      "hello",
      8,
      13
    );

    mockExecFileSync.mockReturnValueOnce("/usr/bin/rg\n");
    mockExecFileSync.mockReturnValueOnce(rgOutput);

    const result = await searchCode("/project", "hello");

    const match = result.matches[0];
    expect(match.lineNumber).toBe(42);
    expect(match.lineText).toBe('  const hello = "world";');
    expect(match.submatches).toHaveLength(1);
    expect(match.submatches[0].start).toBe(8);
    expect(match.submatches[0].end).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// Test 8: truncation → results capped at maxResults
// ---------------------------------------------------------------------------
describe("Test 8: results truncated at maxResults", () => {
  it("caps results at maxResults=200 and sets truncated=true when 250 matches", async () => {
    // Generate 250 match lines
    const lines = Array.from({ length: 250 }, (_, i) =>
      makeRgMatchLine(`/project/src/file${i}.ts`, i + 1, `line content ${i}\n`, "pattern", 0, 7)
    );
    const rgOutput = lines.join("\n");

    mockExecFileSync.mockReturnValueOnce("/usr/bin/rg\n");
    mockExecFileSync.mockReturnValueOnce(rgOutput);

    const result = await searchCode("/project", "pattern", undefined, 200);

    expect(result.matches.length).toBe(200);
    expect(result.truncated).toBe(true);
  });
});
