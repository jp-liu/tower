import { describe, expect, it, vi } from "vitest";
import { listExtensionMetadata } from "../metadata";
import {
  buildExtensionInventory,
  buildLegacyExtensionInventory,
} from "../inventory-service";

describe("extension inventory service", () => {
  it("checks legacy definitions concurrently and returns stable IDs", async () => {
    const pending = new Map<string, () => void>();
    const readStatus = vi.fn((id: string) => new Promise<{ installed: boolean }>((resolve) => {
      pending.set(id, () => resolve({ installed: id === "monaco" }));
    }));
    const inventoryPromise = buildLegacyExtensionInventory(
      listExtensionMetadata(),
      readStatus,
    );

    expect(readStatus).toHaveBeenCalledTimes(4);
    for (const release of pending.values()) release();

    const inventory = await inventoryPromise;
    expect(inventory.map((item) => item.id)).toEqual([
      "system.ripgrep",
      "tower.gateway-agent",
      "tower.monaco",
    ]);
    expect(inventory.find((item) => item.id === "tower.monaco")?.installed)
      .toEqual({ version: null, enabled: true });
  });

  it("isolates a failed check instead of failing inventory discovery", async () => {
    const inventory = await buildLegacyExtensionInventory(
      [listExtensionMetadata()[1]!],
      async () => {
        throw new Error("probe crashed");
      },
    );

    expect(inventory[0]).toMatchObject({
      id: "tower.monaco",
      health: "error",
      diagnostics: [{
        code: "LEGACY_CHECK_FAILED",
        message: "probe crashed",
      }],
    });
  });

  it("retains installed providers when the Catalog is unavailable", async () => {
    const inventory = await buildExtensionInventory({
      legacy: async () => [],
      catalogProviders: async () => {
        throw new Error("catalog unavailable");
      },
      installedProviders: async () => [{
        id: "local.provider",
        version: "1.0.0",
        source: "local",
        enabled: true,
        displayName: "Local Provider",
        permissions: [],
        permissionConfirmed: true,
        installedAt: "2026-07-30T00:00:00.000Z",
        updatedAt: "2026-07-30T00:00:00.000Z",
        health: "ready",
        dependency: null,
        capabilities: null,
      }],
    });

    expect(inventory).toMatchObject([{
      id: "local.provider",
      kind: "cli-provider",
      source: { type: "local-development" },
      installed: { enabled: true },
    }]);
  });
});
