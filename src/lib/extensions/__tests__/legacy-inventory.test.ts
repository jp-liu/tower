import { describe, expect, it } from "vitest";
import { getExtensionMetadata } from "../metadata";
import { mergeLegacyInventory, projectLegacyExtension } from "../legacy-inventory";

function metadata(id: "rg" | "monaco" | "tower-agent-openclaw" | "tower-agent-hermes") {
  const value = getExtensionMetadata(id);
  if (!value) throw new Error(`missing test metadata: ${id}`);
  return value;
}

describe("legacy extension inventory projection", () => {
  it("models ripgrep as a detected system dependency", () => {
    const item = projectLegacyExtension(metadata("rg"), {
      installed: true,
      version: "14.1.0",
    });

    expect(item).toMatchObject({
      id: "system.ripgrep",
      legacyIds: ["rg"],
      kind: "system-dependency",
      source: { type: "system", trust: "tower" },
      installed: { version: "14.1.0", enabled: true },
      health: "ready",
      capabilities: ["code-search"],
    });
    expect(item.lifecycle.install).toBe(false);
  });

  it("models Monaco as a Tower component", () => {
    const item = projectLegacyExtension(metadata("monaco"), {
      installed: false,
    });

    expect(item).toMatchObject({
      id: "tower.monaco",
      legacyIds: ["monaco"],
      kind: "tower-component",
      source: { type: "builtin", publisherId: "tower", trust: "tower" },
      installed: null,
      capabilities: ["code-editor"],
    });
    expect(item.lifecycle.install).toBe(true);
  });

  it("merges OpenClaw and Hermes into one gateway extension", () => {
    const items = mergeLegacyInventory([
      projectLegacyExtension(metadata("tower-agent-openclaw"), {
        installed: true,
        version: "1",
      }),
      projectLegacyExtension(metadata("tower-agent-hermes"), {
        installed: false,
      }),
    ]);

    const gateway = items.find((item) => item.id === "tower.gateway-agent");
    expect(gateway).toMatchObject({
      legacyIds: ["tower-agent-openclaw", "tower-agent-hermes"],
      kind: "gateway-adapter",
      installed: { version: null, enabled: true },
      health: "ready",
    });
    expect(gateway?.deployments?.map((deployment) => ({
      targetId: deployment.targetId,
      installed: deployment.installed,
    }))).toEqual([
      { targetId: "hermes", installed: false },
      { targetId: "openclaw", installed: true },
    ]);
  });

  it("preserves check failures as safe diagnostics", () => {
    const item = projectLegacyExtension(metadata("monaco"), {
      installed: false,
      error: "manifest missing",
    });

    expect(item.health).toBe("error");
    expect(item.diagnostics).toEqual([{
      code: "LEGACY_CHECK_FAILED",
      severity: "error",
      message: "manifest missing",
    }]);
  });
});

