// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

// Helper — dynamic re-import of ripgrep extension after mock setup
async function loadRipgrep() {
  const { ripgrepExtension } = await import("../definitions/ripgrep");
  return ripgrepExtension;
}

describe("ripgrep extension — dual-track check", () => {
  it("returns installed:true with package binary path when @vscode/ripgrep is resolvable", async () => {
    vi.doMock("@vscode/ripgrep", () => ({
      rgPath: "/repo/node_modules/@vscode/ripgrep/bin/rg",
    }));
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, "ripgrep 14.1.1\n");
      }
    );

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.path).toContain("ripgrep");
    expect(status.version).toBe("14.1.1");
  });

  it("falls back to system rg via `which` when @vscode/ripgrep is NOT resolvable", async () => {
    vi.doMock("@vscode/ripgrep", () => {
      throw new Error("Cannot find module '@vscode/ripgrep'");
    });
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        if (cmd === "which" && args[0] === "rg") {
          cb(null, "/opt/homebrew/bin/rg\n");
        } else if (args[0] === "--version") {
          cb(null, "ripgrep 14.0.0\n");
        }
      }
    );

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.path).toBe("/opt/homebrew/bin/rg");
  });

  it("returns installed:false when both package binary and system rg are missing", async () => {
    vi.doMock("@vscode/ripgrep", () => {
      throw new Error("Cannot find module '@vscode/ripgrep'");
    });
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(new Error("not found"), "");
      }
    );

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(false);
  });

  it("install runs pnpm add @vscode/ripgrep and returns success", async () => {
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, "");
      }
    );

    const ext = await loadRipgrep();
    const result = await ext.install();
    expect(result.success).toBe(true);
    expect(cp.execFile).toHaveBeenCalledWith(
      "pnpm",
      ["add", "@vscode/ripgrep"],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it("install returns success:false with error when pnpm fails", async () => {
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error("pnpm: network unreachable"));
      }
    );

    const ext = await loadRipgrep();
    const result = await ext.install();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network unreachable/);
  });
});
