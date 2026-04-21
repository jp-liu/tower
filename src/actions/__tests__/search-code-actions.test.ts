import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted required for child_process mock in jsdom vitest environment
const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  default: { execFile: mockExecFile },
  execFile: mockExecFile,
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

// Helper: mock execFile to call callback with success
function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, stdout, "");
      return {};
    }
  );
}

// Helper: mock execFile to call callback with error
function mockExecFileError(code: number, message = "Command failed") {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error & { code?: number }, stdout: string, stderr: string) => void) => {
      const err = Object.assign(new Error(message), { code });
      cb(err, "", "");
      return {};
    }
  );
}

// ---------------------------------------------------------------------------
// Test 1 (SEARCH-02): rg exit 0 → returns matches array with SearchMatch objects
// ---------------------------------------------------------------------------
describe("Test 1: rg exit 0 returns matches", () => {
  it("returns non-empty matches array, no error", async () => {
    const rgOutput = [
      makeRgMatchLine("/project/src/foo.ts", 42, '  const hello = "world";\n', "hello", 8, 13),
      JSON.stringify({ type: "summary", data: {} }),
    ].join("\n");

    mockExecFileSuccess("/usr/bin/rg\n"); // which rg
    mockExecFileSuccess(rgOutput);        // rg search

    const result = await searchCode("/project", "hello");

    expect(result.error).toBeUndefined();
    expect(result.matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2 (SEARCH-02): rg exit 1 (no matches) → returns empty matches
// ---------------------------------------------------------------------------
describe("Test 2: rg exit 1 returns empty matches", () => {
  it("exit code 1 returns empty matches array without error", async () => {
    mockExecFileSuccess("/usr/bin/rg\n"); // which rg
    mockExecFileError(1);                 // rg exits 1 (no matches)

    const result = await searchCode("/project", "nomatch_xyz");

    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 3 (SEARCH-02): rg exit 2+ (error) → returns sanitized error string
// ---------------------------------------------------------------------------
describe("Test 3: rg exit 2+ returns error string", () => {
  it("exit code 2 returns error string", async () => {
    mockExecFileSuccess("/usr/bin/rg\n"); // which rg
    mockExecFileError(2, "rg error");     // rg exits 2

    const result = await searchCode("/project", "pattern");

    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Test 4 (SEARCH-02): rg not installed → returns error string
// ---------------------------------------------------------------------------
describe("Test 4: rg not installed returns error string", () => {
  it("returns error including 'ripgrep' when which check fails", async () => {
    mockExecFileError(1, "which: no rg in PATH"); // which rg fails

    const result = await searchCode("/project", "pattern");

    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/ripgrep|rg.*not installed/i);
  });
});

// ---------------------------------------------------------------------------
// Test 5 (SEARCH-03): glob filter → --glob arg is passed
// ---------------------------------------------------------------------------
describe("Test 5: glob filter passes --glob arg", () => {
  it("passes --glob and the glob value to rg args", async () => {
    const rgOutput = makeRgMatchLine("/project/src/foo.ts", 1, "hello world\n", "hello", 0, 5);

    mockExecFileSuccess("/usr/bin/rg\n"); // which rg
    mockExecFileSuccess(rgOutput);        // rg search

    await searchCode("/project", "hello", "*.ts");

    const calls = mockExecFile.mock.calls;
    const rgCall = calls.find((c: unknown[]) => c[0] === "rg");
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
      "/project/src/foo.ts", 42, '  const hello = "world";\n', "hello", 8, 13
    );

    mockExecFileSuccess("/usr/bin/rg\n");
    mockExecFileSuccess(rgOutput);

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
      "/project/src/foo.ts", 42, '  const hello = "world";\n', "hello", 8, 13
    );

    mockExecFileSuccess("/usr/bin/rg\n");
    mockExecFileSuccess(rgOutput);

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
    const lines = Array.from({ length: 250 }, (_, i) =>
      makeRgMatchLine(`/project/src/file${i}.ts`, i + 1, `line content ${i}\n`, "pattern", 0, 7)
    );
    const rgOutput = lines.join("\n");

    mockExecFileSuccess("/usr/bin/rg\n");
    mockExecFileSuccess(rgOutput);

    const result = await searchCode("/project", "pattern", undefined, 200);

    expect(result.matches.length).toBe(200);
    expect(result.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 9: relative path rejected
// ---------------------------------------------------------------------------
describe("Test 9: relative localPath rejected", () => {
  it("returns error for relative path like '../etc'", async () => {
    const result = await searchCode("../etc", "password");
    expect(result.error).toBeDefined();
    expect(result.matches).toEqual([]);
  });

  it("returns error for bare directory name", async () => {
    const result = await searchCode("my-project", "hello");
    expect(result.error).toBeDefined();
    expect(result.matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 10: pattern boundary — 500 chars accepted, 501 rejected
// ---------------------------------------------------------------------------
describe("Test 10: pattern boundary — 500 chars accepted, 501 rejected", () => {
  it("500-char pattern is accepted", async () => {
    const longPattern = "a".repeat(500);
    mockExecFileSuccess("/usr/bin/rg\n");
    mockExecFileError(1); // no matches

    const result = await searchCode("/project", longPattern);
    expect(result.error).toBeUndefined();
  });

  it("501-char pattern is rejected with validation error", async () => {
    const tooLongPattern = "a".repeat(501);
    const result = await searchCode("/project", tooLongPattern);
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/[Ii]nvalid/);
  });
});

// ---------------------------------------------------------------------------
// Test 11: maxResults boundary values
// ---------------------------------------------------------------------------
describe("Test 11: maxResults boundary values", () => {
  it("maxResults=1 returns at most 1 result", async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      makeRgMatchLine(`/project/f${i}.ts`, i + 1, `line ${i}\n`, "x", 0, 1)
    );
    mockExecFileSuccess("/usr/bin/rg\n");
    mockExecFileSuccess(lines.join("\n"));

    const result = await searchCode("/project", "x", undefined, 1);
    expect(result.matches.length).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("maxResults=0 is rejected by Zod (min 1)", async () => {
    const result = await searchCode("/project", "x", undefined, 0);
    expect(result.error).toBeDefined();
  });

  it("maxResults=501 is rejected by Zod (max 500)", async () => {
    const result = await searchCode("/project", "x", undefined, 501);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 12: error messages sanitized — no server path leaks
// ---------------------------------------------------------------------------
describe("Test 12: error messages sanitized", () => {
  it("rg error does not contain file system paths", async () => {
    mockExecFileSuccess("/usr/bin/rg\n");
    mockExecFileError(2, "rg: /secret/internal/path: Permission denied");

    const result = await searchCode("/project", "pattern");
    expect(result.error).toBeDefined();
    expect(result.error).not.toContain("/secret/internal/path");
    expect(result.error).not.toContain("Permission denied");
  });
});

// ---------------------------------------------------------------------------
// Test 13: execFile uses timeout option
// ---------------------------------------------------------------------------
describe("Test 13: rg invocation includes timeout", () => {
  it("passes timeout option to execFile", async () => {
    const rgOutput = makeRgMatchLine("/project/src/foo.ts", 1, "hello\n", "hello", 0, 5);
    mockExecFileSuccess("/usr/bin/rg\n");
    mockExecFileSuccess(rgOutput);

    await searchCode("/project", "hello");

    const rgCall = mockExecFile.mock.calls.find((c: unknown[]) => c[0] === "rg");
    expect(rgCall).toBeDefined();
    const opts = rgCall![2] as { timeout?: number };
    expect(opts.timeout).toBe(10_000);
  });
});
