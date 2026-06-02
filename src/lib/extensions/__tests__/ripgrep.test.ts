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

// Default: no bundled binary, so the system-detection branches are exercised.
// Individual tests override this to test the bundled-first path.
const mockResolveBundledRgPath = vi.hoisted(() => vi.fn(async (): Promise<string | null> => null));
vi.mock("../rg-resolve", () => ({
  resolveBundledRgPath: mockResolveBundledRgPath,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockResolveBundledRgPath.mockImplementation(async () => null);
});

async function loadRipgrep() {
  const { ripgrepExtension } = await import("../definitions/ripgrep");
  return ripgrepExtension;
}

describe("ripgrep extension", () => {
  it("check() prefers the bundled @vscode/ripgrep binary when present", async () => {
    mockResolveBundledRgPath.mockImplementation(async () => "/bundled/@vscode/ripgrep/bin/rg");
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, "ripgrep 15.0.0\n");
      }
    );

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.path).toBe("/bundled/@vscode/ripgrep/bin/rg");
    expect(status.version).toBe("15.0.0");
  });

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

  it("check() reports not installed when `which rg` throws and no known fallback path exists", async () => {
    const cp = await import("child_process");
    (cp.execFileSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("not found");
    });
    // The fallback path scan would otherwise find /opt/homebrew/bin/rg on
    // the dev machine — force existsSync to false so we exercise the
    // "nothing anywhere" branch.
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(false);
  });

  it("check() falls back to a known install path when `which rg` returns nothing", async () => {
    const cp = await import("child_process");
    (cp.execFileSync as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("not found"); // which/where
    }).mockImplementation(() => "ripgrep 14.1.1\n"); // version probe via execFile
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, "ripgrep 14.1.1\n");
      }
    );
    // First known path exists, rest don't matter.
    const fs = await import("fs");
    let hits = 0;
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ++hits === 1);

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.path).toMatch(/rg$/);
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
