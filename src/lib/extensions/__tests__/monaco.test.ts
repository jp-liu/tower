// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, existsSync: vi.fn(), readFileSync: vi.fn(), rmSync: vi.fn(), cpSync: vi.fn() };
});

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function loadMonaco() {
  const { monacoExtension } = await import("../definitions/monaco");
  return monacoExtension;
}

describe("monaco extension — check", () => {
  it("returns installed:true with version when both monaco-editor and public/vs exist", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({ version: "0.55.1" })
    );

    const ext = await loadMonaco();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.55.1");
    expect(status.path).toContain("vs");
  });

  it("returns installed:false when monaco-editor package.json is missing", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      // package.json missing, public/vs/loader.js exists
      return !String(p).includes("monaco-editor/package.json");
    });

    const ext = await loadMonaco();
    const status = await ext.check();
    expect(status.installed).toBe(false);
  });

  it("returns installed:false when monaco-editor/min/vs/loader.js is missing", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      // package.json exists, loader.js missing
      return !String(p).includes("min/vs/loader.js");
    });

    const ext = await loadMonaco();
    const status = await ext.check();
    expect(status.installed).toBe(false);
  });

  it("returns installed:true with undefined version when package.json is malformed", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue("not-valid-json");

    const ext = await loadMonaco();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.version).toBeUndefined();
  });
});

describe("monaco extension — install", () => {
  it("install runs npm install — no public/vs copy needed (API route serves files in place)", async () => {
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, "");
      }
    );
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ext = await loadMonaco();
    const result = await ext.install();
    expect(result.success).toBe(true);
    expect(cp.execFile).toHaveBeenCalledTimes(1);
    expect((cp.execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("npm");
    expect((cp.execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(
      expect.arrayContaining(["install", "monaco-editor"]),
    );
    // No cpSync — `/api/internal/monaco/[...]` streams files from node_modules directly.
    expect(fs.cpSync).not.toHaveBeenCalled();
  });

  it("install reports failure when npm succeeds but package.json is missing", async () => {
    // Simulate: npm install "succeeds" but doesn't actually drop the package
    // anywhere we can find — e.g. user has `prefix=` in ~/.npmrc hoisting it.
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, "");
      }
    );
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const ext = await loadMonaco();
    const result = await ext.install();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/doesn't exist|npmrc/i);
  });

  it("install returns success:false when npm fails", async () => {
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error("npm: registry timeout"));
      }
    );

    const ext = await loadMonaco();
    const result = await ext.install();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/registry timeout/);
  });
});

describe("monaco extension — uninstall", () => {
  it("uninstall runs npm uninstall (no public/vs cleanup needed)", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(null);
      }
    );

    const ext = await loadMonaco();
    const result = await ext.uninstall!();
    expect(result.success).toBe(true);
    expect(cp.execFile).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["uninstall", "monaco-editor"]),
      expect.any(Object),
      expect.any(Function)
    );
  });
});
