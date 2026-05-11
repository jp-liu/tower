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

  it("returns installed:false when public/vs/loader.js is missing", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
      // package.json exists, loader.js missing
      return !String(p).includes("public/vs/loader.js");
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
  it("install runs pnpm add then inline-copies vs assets to public/vs", async () => {
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
    expect((cp.execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("pnpm");
    expect((cp.execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual(["add", "monaco-editor"]);
    expect(fs.cpSync).toHaveBeenCalledWith(
      expect.stringContaining("monaco-editor/min/vs"),
      expect.stringContaining("public/vs"),
      expect.objectContaining({ recursive: true })
    );
  });

  it("install reports failure when pnpm succeeds but vs source is missing", async () => {
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
    expect(result.error).toMatch(/min\/vs not found/);
  });

  it("install returns success:false when pnpm fails", async () => {
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error("pnpm: registry timeout"));
      }
    );

    const ext = await loadMonaco();
    const result = await ext.install();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/registry timeout/);
  });
});

describe("monaco extension — uninstall", () => {
  it("uninstall removes public/vs then runs pnpm remove", async () => {
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
    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining("vs"),
      expect.objectContaining({ recursive: true, force: true })
    );
    expect(cp.execFile).toHaveBeenCalledWith(
      "pnpm",
      ["remove", "monaco-editor"],
      expect.any(Object),
      expect.any(Function)
    );
  });
});
