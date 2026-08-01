import type {
  CliPluginListItem,
  CliProviderCatalogItem,
} from "@/lib/ai/cli-plugin-service";
import type { ExtensionHealth, ExtensionInventoryItem } from "./inventory-types";

const CLI_LIFECYCLE = {
  install: true,
  configure: true,
  enable: true,
  disable: true,
  update: true,
  repair: true,
  remove: true,
} as const;

function sourceForPlugin(
  source: CliPluginListItem["source"],
): ExtensionInventoryItem["source"] {
  if (source === "development" || source === "local") {
    return { type: "local-development", trust: "unverified" };
  }
  if (source === "npm" || source === "legacy") {
    return { type: "package-registry", trust: "unverified" };
  }
  return { type: "catalog", trust: "unverified" };
}

function providerCapabilities(plugin: CliPluginListItem): string[] {
  const capabilities = plugin.capabilities;
  if (!capabilities) return [];
  const result = ["sessions:fresh", "query:generate"];
  if (capabilities.sessions.resume) result.push("sessions:resume");
  if (capabilities.sessions.continue) result.push("sessions:continue");
  if (capabilities.query.stream) result.push("query:stream");
  if (capabilities.models) result.push("models");
  if (capabilities.integrations?.mcp) result.push("integration:mcp");
  if (capabilities.integrations?.hooks) result.push("integration:hooks");
  if (capabilities.integrations?.skills) result.push("integration:skills");
  return result;
}

function providerHealth(plugin: CliPluginListItem): ExtensionHealth {
  if (plugin.health === "ready" || plugin.health === "disabled") return "ready";
  if (plugin.health === "corrupt") return "error";
  return "degraded";
}

function providerDiagnostics(plugin: CliPluginListItem) {
  if (plugin.health === "ready" || plugin.health === "disabled") return [];
  return [{
    code: `CLI_PROVIDER_${plugin.health.replaceAll("-", "_").toUpperCase()}`,
    severity: plugin.health === "corrupt" ? "error" as const : "warning" as const,
    message: plugin.dependency
      ? `${plugin.dependency.dependency}: ${plugin.dependency.state}`
      : `CLI Provider state: ${plugin.health}`,
  }];
}

function projectInstalledProvider(plugin: CliPluginListItem): ExtensionInventoryItem {
  const diagnostics = providerDiagnostics(plugin);
  return {
    id: plugin.id,
    kind: "cli-provider",
    display: {
      name: plugin.displayName,
      description: "Installed CLI Provider",
      iconKey: "terminal",
    },
    source: sourceForPlugin(plugin.source),
    installed: {
      version: plugin.version,
      enabled: plugin.enabled,
      installedAt: plugin.installedAt,
    },
    available: null,
    compatibility: "compatible",
    health: providerHealth(plugin),
    capabilities: providerCapabilities(plugin),
    permissions: [...plugin.permissions],
    lifecycle: {
      ...CLI_LIFECYCLE,
      install: false,
      enable: !plugin.enabled,
      disable: plugin.enabled,
      update: false,
      repair: plugin.health !== "ready" && plugin.health !== "disabled",
    },
    diagnostics,
  };
}

function projectCatalogProvider(item: CliProviderCatalogItem): ExtensionInventoryItem {
  const installed = item.installed;
  const projected = installed ? projectInstalledProvider(installed) : null;
  const catalogSource = {
    type: "catalog" as const,
    publisherId: item.publisher.id,
    // Catalog v1 authenticates artifact integrity, not publisher identity.
    // A publisher named "tower" must not be promoted to trusted provenance.
    trust: "unverified" as const,
  };
  const source = projected && projected.source.type !== "catalog"
    ? projected.source
    : catalogSource;
  const sourceConflict = Boolean(projected && projected.source.type !== "catalog");
  return {
    ...(projected ?? {
      id: item.id,
      kind: "cli-provider" as const,
      installed: null,
      compatibility: "compatible" as const,
      health: "unknown" as const,
      capabilities: [],
      permissions: [],
      diagnostics: [],
    }),
    display: sourceConflict
      ? projected!.display
      : {
          name: item.display.name,
          description: item.display.description ?? "CLI Provider",
          ...(item.display.homepage ? { homepage: item.display.homepage } : {}),
          iconKey: "terminal",
        },
    source,
    available: { version: item.latestVersion },
    lifecycle: {
      ...CLI_LIFECYCLE,
      install: !installed,
      configure: Boolean(installed),
      enable: Boolean(installed && !installed.enabled),
      disable: Boolean(installed?.enabled),
      update: item.updateAvailable && !sourceConflict,
      repair: Boolean(installed && installed.health !== "ready" && installed.health !== "disabled"),
      remove: Boolean(installed),
    },
    diagnostics: [
      ...(projected?.diagnostics ?? []),
      ...(sourceConflict ? [{
        code: "CLI_PROVIDER_SOURCE_CONFLICT",
        severity: "info" as const,
        message: "An installed non-Catalog Provider shares this Catalog ID",
      }] : []),
    ],
  };
}

export function mergeCliProviderInventory(
  catalog: CliProviderCatalogItem[],
  installed: CliPluginListItem[],
): ExtensionInventoryItem[] {
  const byId = new Map<string, ExtensionInventoryItem>();
  const installedById = new Map(installed.map((plugin) => [plugin.id, plugin]));
  for (const item of catalog) {
    byId.set(item.id, projectCatalogProvider({
      ...item,
      installed: installedById.get(item.id) ?? item.installed,
    }));
  }
  for (const plugin of installed) {
    if (!byId.has(plugin.id)) byId.set(plugin.id, projectInstalledProvider(plugin));
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
