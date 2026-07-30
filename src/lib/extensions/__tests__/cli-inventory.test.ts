import { describe, expect, it } from "vitest";
import type {
  CliPluginListItem,
  CliProviderCatalogItem,
} from "@/lib/ai/cli-plugin-service";
import { mergeCliProviderInventory } from "../cli-inventory";

function installed(
  overrides: Partial<CliPluginListItem> = {},
): CliPluginListItem {
  return {
    id: "community.qwen-code",
    version: "1.0.0",
    source: "catalog",
    enabled: false,
    displayName: "Qwen Code",
    permissions: ["process:spawn"],
    permissionConfirmed: true,
    installedAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    health: "disabled",
    dependency: null,
    capabilities: {
      sessions: { fresh: true, resume: true },
      query: { generate: true, stream: true },
      models: true,
    },
    ...overrides,
  };
}

function catalog(
  plugin: CliPluginListItem | null,
): CliProviderCatalogItem {
  return {
    id: "community.qwen-code",
    kind: "cli-provider",
    publisher: { id: "community", name: "Community" },
    display: {
      name: "Qwen Code",
      description: "Qwen CLI Provider",
      homepage: "https://example.com/qwen",
    },
    latestVersion: "1.1.0",
    versions: [{ version: "1.1.0", cliDependency: null }],
    installed: plugin,
    updateAvailable: Boolean(plugin),
  };
}

describe("CLI Provider inventory projection", () => {
  it("combines available and installed Catalog state", () => {
    const item = mergeCliProviderInventory([catalog(installed())], [installed()])[0]!;
    expect(item).toMatchObject({
      id: "community.qwen-code",
      kind: "cli-provider",
      installed: { version: "1.0.0", enabled: false },
      available: { version: "1.1.0" },
      source: { type: "catalog", publisherId: "community", trust: "unverified" },
      health: "ready",
      permissions: ["process:spawn"],
      lifecycle: {
        install: false,
        configure: true,
        enable: true,
        disable: false,
        update: true,
        remove: true,
      },
    });
    expect(item.capabilities).toEqual([
      "sessions:fresh",
      "query:generate",
      "sessions:resume",
      "query:stream",
      "models",
    ]);
  });

  it("joins registry state when the Catalog snapshot has no embedded install", () => {
    const plugin = installed();
    const item = mergeCliProviderInventory([catalog(null)], [plugin])[0]!;
    expect(item).toMatchObject({
      installed: { version: "1.0.0", enabled: false },
      available: { version: "1.1.0" },
      permissions: ["process:spawn"],
    });
  });

  it("keeps installed local source identity when the same ID exists in Catalog", () => {
    const local = installed({ source: "development", displayName: "My Local Provider" });
    const item = mergeCliProviderInventory([catalog(local)], [local])[0]!;
    expect(item.source).toEqual({ type: "local-development", trust: "unverified" });
    expect(item.display.name).toBe("My Local Provider");
    expect(item.lifecycle.update).toBe(false);
    expect(item.diagnostics).toContainEqual({
      code: "CLI_PROVIDER_SOURCE_CONFLICT",
      severity: "info",
      message: "An installed non-Catalog Provider shares this Catalog ID",
    });
  });

  it("retains installed providers that are absent from Catalog", () => {
    const item = mergeCliProviderInventory([], [
      installed({ id: "local.private-provider", source: "local", enabled: true, health: "ready" }),
    ])[0]!;
    expect(item).toMatchObject({
      id: "local.private-provider",
      source: { type: "local-development" },
      installed: { enabled: true },
      available: null,
      health: "ready",
    });
  });

  it("does not misclassify direct npm installs as Catalog entries", () => {
    const item = mergeCliProviderInventory([], [
      installed({ source: "npm" }),
    ])[0]!;
    expect(item.source).toEqual({
      type: "package-registry",
      trust: "unverified",
    });
  });

  it("surfaces corrupt registrations as errors", () => {
    const item = mergeCliProviderInventory([], [
      installed({ health: "corrupt", capabilities: null }),
    ])[0]!;
    expect(item.health).toBe("error");
    expect(item.diagnostics[0]).toMatchObject({
      code: "CLI_PROVIDER_CORRUPT",
      severity: "error",
    });
  });

  it("does not trust a Catalog v1 publisher based only on its claimed ID", () => {
    const entry = catalog(null);
    entry.publisher = { id: "tower", name: "Tower" };
    const item = mergeCliProviderInventory([entry], [])[0]!;
    expect(item.source).toEqual({
      type: "catalog",
      publisherId: "tower",
      trust: "unverified",
    });
  });
});
