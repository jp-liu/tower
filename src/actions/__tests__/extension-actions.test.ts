// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/extensions/registry", () => ({
  getExtension: vi.fn(),
  listExtensions: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extension-actions", () => {
  it("checkExtension delegates to registry getExtension(id).check()", async () => {
    const { checkExtension } = await import("../extension-actions");
    const mod = await import("@/lib/extensions/registry");
    const fakeExt = {
      id: "rg",
      check: vi.fn().mockResolvedValue({ installed: true, version: "14" }),
    };
    (mod.getExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fakeExt);

    const status = await checkExtension("rg");
    expect(fakeExt.check).toHaveBeenCalled();
    expect(status.installed).toBe(true);
    expect(status.version).toBe("14");
  });

  it("checkExtension on unknown id returns installed:false + error", async () => {
    const { checkExtension } = await import("../extension-actions");
    const mod = await import("@/lib/extensions/registry");
    (mod.getExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);

    // @ts-expect-error invalid id by design
    const status = await checkExtension("bogus");
    expect(status.installed).toBe(false);
    expect(status.error).toMatch(/unknown extension/i);
  });

  it("installExtension delegates to install()", async () => {
    const { installExtension } = await import("../extension-actions");
    const mod = await import("@/lib/extensions/registry");
    const fakeExt = {
      id: "rg",
      install: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
    };
    (mod.getExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fakeExt);

    const result = await installExtension("rg");
    expect(fakeExt.install).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("installExtension on unknown id returns success:false + error", async () => {
    const { installExtension } = await import("../extension-actions");
    const mod = await import("@/lib/extensions/registry");
    (mod.getExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);

    // @ts-expect-error invalid id
    const result = await installExtension("bogus");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown extension/i);
  });

  it("uninstallExtension delegates to uninstall()", async () => {
    const { uninstallExtension } = await import("../extension-actions");
    const mod = await import("@/lib/extensions/registry");
    const fakeExt = {
      id: "rg",
      uninstall: vi.fn().mockResolvedValue({ success: true, message: "removed" }),
    };
    (mod.getExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fakeExt);

    const result = await uninstallExtension("rg");
    expect(fakeExt.uninstall).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("uninstallExtension when extension does not support uninstall returns error", async () => {
    const { uninstallExtension } = await import("../extension-actions");
    const mod = await import("@/lib/extensions/registry");
    (mod.getExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      id: "rg",
      // no uninstall method
    });

    const result = await uninstallExtension("rg");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not support uninstall/i);
  });

  it("listAllExtensionStatus returns map keyed by ext id", async () => {
    const { listAllExtensionStatus } = await import("../extension-actions");
    const mod = await import("@/lib/extensions/registry");
    (mod.listExtensions as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: "rg", check: () => Promise.resolve({ installed: true }) },
      { id: "monaco", check: () => Promise.resolve({ installed: false }) },
    ]);
    const all = await listAllExtensionStatus();
    expect(all.rg.installed).toBe(true);
    expect(all.monaco.installed).toBe(false);
  });
});
