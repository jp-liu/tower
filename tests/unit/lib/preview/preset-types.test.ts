import { describe, it, expect } from "vitest";
import type { PreviewPreset, DetectContext } from "@/lib/preview/preset-types";

describe("PreviewPreset type", () => {
  it("compiles a minimal preset shape", () => {
    const preset: PreviewPreset = {
      id: "test",
      name: "Test",
      icon: "simple-icons:test",
      detect: () => true,
      command: "echo hi",
      port: 3000,
      installCommand: null,
      installMarker: null,
      readyRegex: null,
      urlExtractRegex: null,
    };
    expect(preset.id).toBe("test");
  });

  it("DetectContext provides files map and hasDir", () => {
    const ctx: DetectContext = {
      files: { "package.json": null },
      hasDir: (rel) => rel === "node_modules",
    };
    expect(ctx.hasDir("node_modules")).toBe(true);
    expect(ctx.hasDir("dist")).toBe(false);
  });
});
