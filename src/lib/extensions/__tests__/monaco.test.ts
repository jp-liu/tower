// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => JSON.stringify({ version: "0.55.1" })),
    rmSync: vi.fn(),
  };
});

// Mock the download helper used by `install()` so tests don't hit the network.
vi.mock("../download", () => ({
  downloadAndExtract: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function loadMonaco() {
  const { monacoExtension } = await import("../definitions/monaco");
  return monacoExtension;
}

describe("monaco extension — check", () => {
  it("reports installed when package.json + min/vs/loader.js both exist", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ext = await loadMonaco();
    const status = await ext.check();
    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.55.1");
  });

  it("reports not installed when package.json is missing", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (p: unknown) => !String(p).endsWith("package.json"),
    );

    const ext = await loadMonaco();
    const status = await ext.check();
    expect(status.installed).toBe(false);
  });

  it("reports not installed when loader.js is missing", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (p: unknown) => !String(p).endsWith("loader.js"),
    );

    const ext = await loadMonaco();
    const status = await ext.check();
    expect(status.installed).toBe(false);
  });
});

describe("monaco extension — install", () => {
  it("install() calls downloadAndExtract with monaco-editor@pinned-version", async () => {
    const dl = await import("../download");
    (dl.downloadAndExtract as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const fs = await import("fs");
    // clearAllMocks() in beforeEach wipes our default impl, restore for this test
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ext = await loadMonaco();
    const result = await ext.install();
    expect(result.success).toBe(true);
    expect(dl.downloadAndExtract).toHaveBeenCalledWith(
      "monaco-editor",
      expect.stringMatching(/^\d+\.\d+\.\d+$/),
      expect.stringContaining("monaco"),
    );
  });

  it("install() surfaces download errors verbatim", async () => {
    const dl = await import("../download");
    (dl.downloadAndExtract as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("npmmirror: 503 Service Unavailable"),
    );
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ext = await loadMonaco();
    const result = await ext.install();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/npmmirror.*503/);
  });

  it("install() reports failure when download succeeded but loader.js is still missing", async () => {
    const dl = await import("../download");
    (dl.downloadAndExtract as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const ext = await loadMonaco();
    const result = await ext.install();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/loader\.js.*missing|layout/i);
  });
});

describe("monaco extension — uninstall", () => {
  it("uninstall removes the monaco dir", async () => {
    const fs = await import("fs");
    (fs.existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const ext = await loadMonaco();
    const result = await ext.uninstall!();
    expect(result.success).toBe(true);
    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining("monaco"),
      expect.objectContaining({ recursive: true, force: true }),
    );
  });
});
