// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return { ...actual, existsSync: vi.fn(() => true) };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function loadRipgrep() {
  const { ripgrepExtension } = await import("../definitions/ripgrep");
  return ripgrepExtension;
}

describe("ripgrep extension", () => {
  it("check() reports installed when `which rg` returns a path", async () => {
    const cp = await import("child_process");
    (cp.execFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue("/opt/homebrew/bin/rg\n");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, "ripgrep 14.1.1\n");
      }
    );

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.path).toBe("/opt/homebrew/bin/rg");
    expect(status.version).toBe("14.1.1");
  });

  it("check() reports not installed when `which rg` throws", async () => {
    const cp = await import("child_process");
    (cp.execFileSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("not found");
    });

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(false);
  });

  it("install() never auto-installs — returns a manual-install hint", async () => {
    const ext = await loadRipgrep();
    const result = await ext.install();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/native binary|OS package manager/i);
  });

  it("manualInstall flag is set so the UI shows the homepage button", async () => {
    const ext = await loadRipgrep();
    expect(ext.manualInstall).toBe(true);
  });
});
