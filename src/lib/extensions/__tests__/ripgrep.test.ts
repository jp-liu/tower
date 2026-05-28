// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as os from "os";
import * as fsActual from "fs";
import * as pathActual from "path";

// Pin TOWER_DATA_DIR to a deterministic tmpdir so `EXT_ROOT` is predictable.
// We create a real, minimal `@vscode/ripgrep` package on disk inside the
// extensions workspace so dynamic `import(pkgEntry)` actually loads it —
// vi.doMock can't intercept arbitrary absolute-path imports reliably.
const TEST_TOWER_DIR = pathActual.join(os.tmpdir(), "tower-test-ripgrep-" + process.pid);
process.env.TOWER_DATA_DIR = TEST_TOWER_DIR;
const PKG_DIR = pathActual.join(TEST_TOWER_DIR, "extensions", "node_modules", "@vscode", "ripgrep");
const BIN_RG = pathActual.join(PKG_DIR, "bin", "rg");

function ensurePackageOnDisk(rgBinaryPath: string) {
  fsActual.mkdirSync(pathActual.join(PKG_DIR, "bin"), { recursive: true });
  fsActual.writeFileSync(pathActual.join(PKG_DIR, "package.json"), JSON.stringify({
    name: "@vscode/ripgrep",
    version: "1.17.1",
    main: "index.js",
  }));
  fsActual.writeFileSync(
    pathActual.join(PKG_DIR, "index.js"),
    `module.exports = { rgPath: ${JSON.stringify(rgBinaryPath)} };\n`,
  );
}

function removePackageFromDisk() {
  try {
    fsActual.rmSync(pathActual.join(TEST_TOWER_DIR, "extensions", "node_modules"), { recursive: true, force: true });
  } catch { /* */ }
}

afterAll(() => {
  try { fsActual.rmSync(TEST_TOWER_DIR, { recursive: true, force: true }); } catch { /* */ }
});

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

// Don't mock fs — tests interact with a real tmpdir for the package, but
// system-binary fallback tests need to override existsSync. We use a fresh
// spy in those specific tests.
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  removePackageFromDisk();
});

// Helper — dynamic re-import of ripgrep extension after mock setup
async function loadRipgrep() {
  const { ripgrepExtension } = await import("../definitions/ripgrep");
  return ripgrepExtension;
}

describe("ripgrep extension — dual-track check", () => {
  it("returns installed:true with package binary path when @vscode/ripgrep is resolvable", async () => {
    // Place a real `@vscode/ripgrep` package at the extensions workspace path
    // and have its rgPath point to a real existing file so detectPackageBinary
    // returns it. We use BIN_RG (mkdir+touch'd) as that real file.
    fsActual.mkdirSync(pathActual.join(PKG_DIR, "bin"), { recursive: true });
    fsActual.writeFileSync(BIN_RG, "");
    ensurePackageOnDisk(BIN_RG);

    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, "ripgrep 14.1.1\n");
      }
    );

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.path).toBe(BIN_RG);
    expect(status.version).toBe("14.1.1");
  });

  it("falls back to system rg via `which` when @vscode/ripgrep is NOT resolvable", async () => {
    // No on-disk package → detectPackageBinary returns null → falls through.
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        if ((cmd === "which" || cmd === "where") && args[0] === "rg") {
          cb(null, "/opt/homebrew/bin/rg\n");
        } else if (args[0] === "--version") {
          cb(null, "ripgrep 14.0.0\n");
        }
      }
    );
    // /opt/homebrew/bin/rg might not exist on the test box — make a real
    // empty file so detectSystemBinary's `existsSync` check returns true.
    const SYS_RG = pathActual.join(TEST_TOWER_DIR, "fake-sys-rg");
    fsActual.writeFileSync(SYS_RG, "");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        if ((cmd === "which" || cmd === "where") && args[0] === "rg") {
          cb(null, `${SYS_RG}\n`);
        } else if (args[0] === "--version") {
          cb(null, "ripgrep 14.0.0\n");
        }
      }
    );

    const ext = await loadRipgrep();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.path).toBe(SYS_RG);
  });

  it("returns installed:false when both package binary and system rg are missing", async () => {
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

  it("install runs npm install @vscode/ripgrep and returns success", async () => {
    // npm install is mocked, so we manually drop a fake package on disk to
    // satisfy the post-install verification step.
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        // Pretend npm completed and laid down the package
        fsActual.mkdirSync(pathActual.join(PKG_DIR, "bin"), { recursive: true });
        fsActual.writeFileSync(BIN_RG, "");
        ensurePackageOnDisk(BIN_RG);
        cb(null, "");
      }
    );

    const ext = await loadRipgrep();
    const result = await ext.install();
    expect(result.success).toBe(true);
    expect(cp.execFile).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install", "@vscode/ripgrep"]),
      expect.any(Object),
      expect.any(Function)
    );
  });

  it("install reports failure when npm succeeds but binary still missing", async () => {
    // npm install returns 0 but doesn't lay down the binary (simulates
    // postinstall download failure).
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        // Package shim present but no binary
        ensurePackageOnDisk("/nonexistent/rg");
        cb(null);
      }
    );

    const ext = await loadRipgrep();
    const result = await ext.install();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/binary is missing|postinstall/i);
  });

  it("install returns success:false with error when npm fails", async () => {
    const cp = await import("child_process");
    (cp.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null) => void) => {
        cb(new Error("npm: network unreachable"));
      }
    );

    const ext = await loadRipgrep();
    const result = await ext.install();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network unreachable/);
  });
});
