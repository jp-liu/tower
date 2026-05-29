import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted required for child_process mock in jsdom vitest environment
const mockExecFile = vi.hoisted(() => vi.fn());
const mockExecFileSync = vi.hoisted(() => vi.fn(() => "/opt/homebrew/bin/rg\n"));
// Hoisted so beforeEach can re-arm it — on CI `clearAllMocks` can wipe an
// inline mock's implementation, leaving existsSync returning undefined and
// making resolveRgPath reject the (real-absent) rg path.
const mockExistsSync = vi.hoisted(() => vi.fn(() => true));

vi.mock("child_process", () => ({
  default: { execFile: mockExecFile, execFileSync: mockExecFileSync },
  execFile: mockExecFile,
  execFileSync: mockExecFileSync,
}));

// Mock fs.existsSync so resolveRgPath's binary-existence check passes
// regardless of whether rg is actually installed on the runner.
// NOTE: must be a SYNCHRONOUS factory (like the child_process mock). The async
// `importActual` variant did NOT replace existsSync on CI, so resolveRgPath ran
// the real existsSync — passing locally (rg present) but failing on CI.
// search-code-actions only uses fs.existsSync, so a minimal mock is safe.
vi.mock("fs", () => ({
  existsSync: mockExistsSync,
  default: { existsSync: mockExistsSync },
}));
vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  default: { existsSync: mockExistsSync },
}));

// Mock getConfigValue so timeout is deterministic per-test
vi.mock("@/actions/config-actions", () => ({
  getConfigValue: vi.fn(async (_k: string, def: number) => def),
}));

import { searchCode, clearRgPathCache } from "@/actions/search-code-actions";
import { getConfigValue } from "@/actions/config-actions";

beforeEach(async () => {
  // Deterministic reset: clearAllMocks does NOT clear implementations, and
  // mockReturnValue does NOT override an existing mockImplementation — so on CI
  // (different vitest behavior / test order) execFileSync/existsSync could end
  // up returning the wrong thing and resolveRgPath would reject the rg path
  // ("ripgrep not found"). mockReset() wipes calls + impl + once-queue, then we
  // set explicit implementations so rg resolution is identical everywhere.
  mockExecFile.mockReset();
  mockExecFileSync.mockReset();
  mockExecFileSync.mockImplementation(() => "/opt/homebrew/bin/rg\n");
  mockExistsSync.mockReset();
  mockExistsSync.mockImplementation(() => true);
  (getConfigValue as ReturnType<typeof vi.fn>).mockReset();
  (getConfigValue as ReturnType<typeof vi.fn>).mockImplementation(
    async (_k: string, def: number) => def
  );
  await clearRgPathCache();
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

// Helper: mock execFile to simulate a subprocess timeout (killed by SIGTERM)
function mockExecFileTimeout() {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (
        err: Error & { code?: number | null; killed?: boolean; signal?: string; stderr?: string },
        stdout: string,
        stderr: string
      ) => void
    ) => {
      const err = Object.assign(new Error("Command timed out"), {
        killed: true,
        signal: "SIGTERM",
        code: null,
      });
      cb(err as Error & { killed: boolean; signal: string }, "", "");
      return {};
    }
  );
}

// Helper: mock execFile to simulate an AbortError from caller-supplied signal
function mockExecFileAbort() {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error, stdout: string, stderr: string) => void
    ) => {
      const err = Object.assign(new Error("aborted"), { name: "AbortError" });
      cb(err, "", "");
      return {};
    }
  );
}

// Helper: mock execFile with permission-denied stderr
function mockExecFilePermDenied() {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (
        err: Error & { code?: number; stderr?: string },
        stdout: string,
        stderr: string
      ) => void
    ) => {
      const stderrMsg = "rg: /protected: Permission denied (os error 13)";
      const err = Object.assign(new Error("Command failed"), {
        code: 2,
        stderr: stderrMsg,
      });
      cb(err, "", stderrMsg);
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

    mockExecFileSuccess(rgOutput);

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
    mockExecFileError(1);

    const result = await searchCode("/project", "nomatch_xyz");

    expect(result.matches).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 3 (SEARCH-02): rg exit 2+ (error) → returns error string + errorKind
// ---------------------------------------------------------------------------
describe("Test 3: rg exit 2+ returns error string and errorKind", () => {
  it("exit code 2 returns error string with errorKind=unknown for unrecognised stderr", async () => {
    mockExecFileError(2, "rg: some random error");

    const result = await searchCode("/project", "pattern");

    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
    expect(result.errorKind).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Test 4: uses bundled @vscode/ripgrep binary path
// ---------------------------------------------------------------------------
describe("Test 4: uses bundled ripgrep", () => {
  it("calls execFile with the @vscode/ripgrep rgPath", async () => {
    const rgOutput = makeRgMatchLine("/project/src/foo.ts", 1, "hello\n", "hello", 0, 5);
    mockExecFileSuccess(rgOutput);

    await searchCode("/project", "hello");

    const rgCall = mockExecFile.mock.calls[0];
    expect(rgCall[0]).toMatch(/rg$/);
  });
});

// ---------------------------------------------------------------------------
// Test 5 (SEARCH-03): glob filter → --glob arg is passed
// ---------------------------------------------------------------------------
describe("Test 5: glob filter passes --glob arg", () => {
  it("passes --glob and the glob value to rg args", async () => {
    const rgOutput = makeRgMatchLine("/project/src/foo.ts", 1, "hello world\n", "hello", 0, 5);

    mockExecFileSuccess(rgOutput);

    await searchCode("/project", "hello", "*.ts");

    const rgCall = mockExecFile.mock.calls[0];
    expect(rgCall[0]).toMatch(/rg$/);
    const args = rgCall[1] as string[];
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
      makeRgMatchLine(`/project/src/f${i}.ts`, i + 1, `line ${i}\n`, "x", 0, 1)
    );
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
// Test 12: error includes real rg stderr (desktop app — paths OK)
// Per RELI-04 the actual rg message must surface for debugging.
// ---------------------------------------------------------------------------
describe("Test 12: error includes real rg stderr (desktop app — paths OK)", () => {
  it("rg error contains the stderr message for debugging", async () => {
    mockExecFilePermDenied();

    const result = await searchCode("/project", "pattern");
    expect(result.error).toBeDefined();
    // Per RELI-04 the actual rg message must surface for debugging
    expect(result.error).toContain("Permission denied");
    expect(result.errorKind).toBe("permission_denied");
  });
});

// ---------------------------------------------------------------------------
// Test 13: execFile uses timeout option (now configurable via search.codeTimeoutSec)
// ---------------------------------------------------------------------------
describe("Test 13: rg invocation includes timeout", () => {
  it("passes timeout option to execFile (default 30s = 30_000ms)", async () => {
    const rgOutput = makeRgMatchLine("/project/src/foo.ts", 1, "hello\n", "hello", 0, 5);
    mockExecFileSuccess(rgOutput);

    await searchCode("/project", "hello");

    const rgCall = mockExecFile.mock.calls[0];
    expect(rgCall[0]).toMatch(/rg$/);
    const opts = rgCall[2] as { timeout?: number };
    expect(opts.timeout).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// Test 14: Windows absolute path accepted
// ---------------------------------------------------------------------------
describe("Test 14: Windows absolute path accepted", () => {
  it("accepts Windows-style absolute path C:\\project", async () => {
    mockExecFileError(1); // no matches

    const result = await searchCode("C:\\project", "hello");
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test A (RELI-04): errorKind="timeout" on SIGTERM-killed subprocess
// ---------------------------------------------------------------------------
describe("Test A: errorKind=timeout on SIGTERM kill", () => {
  it("returns errorKind=timeout when execFile killed with SIGTERM", async () => {
    mockExecFileTimeout();

    const result = await searchCode("/project", "pattern");

    expect(result.errorKind).toBe("timeout");
    expect(result.matches).toEqual([]);
    expect(result.aborted).toBeUndefined();
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test B (RELI-04): errorKind="permission_denied" on stderr "permission denied"
// ---------------------------------------------------------------------------
describe("Test B: errorKind=permission_denied on stderr permission_denied", () => {
  it("returns errorKind=permission_denied with truncated stderr in error", async () => {
    mockExecFilePermDenied();

    const result = await searchCode("/project", "pattern");

    expect(result.errorKind).toBe("permission_denied");
    expect(result.error).toContain("Permission denied");
    expect(result.error!.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Test C (RELI-05): errorKind=undefined + aborted=true on AbortError
// ---------------------------------------------------------------------------
describe("Test C: aborted=true when execFile rejects with AbortError", () => {
  it("returns aborted=true and no errorKind/error when caller aborts", async () => {
    mockExecFileAbort();

    const result = await searchCode("/project", "pattern");

    expect(result.aborted).toBe(true);
    expect(result.errorKind).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test D (RELI-04): errorKind="unknown" with truncated stderr fallback
// ---------------------------------------------------------------------------
describe("Test D: errorKind=unknown for unrecognized error", () => {
  it("falls back to errorKind=unknown for unrecognised exit code/message", async () => {
    mockExecFileError(99, "some weird error nobody knows about");

    const result = await searchCode("/project", "pattern");

    expect(result.errorKind).toBe("unknown");
    expect(result.error).toBeDefined();
    expect(result.error!.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Test E (RELI-03): timeout option = configured search.codeTimeoutSec * 1000
// ---------------------------------------------------------------------------
describe("Test E: timeout option = configured value * 1000", () => {
  it("uses 30s default timeout (30000ms)", async () => {
    mockExecFileError(1); // no matches

    await searchCode("/project", "x");

    const opts = mockExecFile.mock.calls[0][2] as { timeout?: number };
    expect(opts.timeout).toBe(30_000);
  });

  it("uses configured timeout when getConfigValue returns 60", async () => {
    (getConfigValue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(60);
    mockExecFileError(1);

    await searchCode("/project", "x");

    const opts = mockExecFile.mock.calls[0][2] as { timeout?: number };
    expect(opts.timeout).toBe(60_000);
  });
});

// ---------------------------------------------------------------------------
// Test F (RELI-05): AbortSignal forwarded to execFile opts.signal
// ---------------------------------------------------------------------------
describe("Test F: signal forwarded to execFile", () => {
  it("forwards AbortSignal to execFile opts", async () => {
    const controller = new AbortController();
    mockExecFileError(1);

    await searchCode("/project", "x", undefined, 200, controller.signal);

    const opts = mockExecFile.mock.calls[0][2] as { signal?: AbortSignal };
    expect(opts.signal).toBe(controller.signal);
  });
});
