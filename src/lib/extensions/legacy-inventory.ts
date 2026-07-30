import type { ExtensionMetadata, ExtensionStatus } from "./types";
import type {
  ExtensionDiagnostic,
  ExtensionInventoryItem,
  ExtensionLifecycle,
} from "./inventory-types";

const COMPONENT_LIFECYCLE: ExtensionLifecycle = {
  install: true,
  configure: false,
  enable: false,
  disable: false,
  update: true,
  repair: true,
  remove: true,
};

const SYSTEM_LIFECYCLE: ExtensionLifecycle = {
  install: false,
  configure: false,
  enable: false,
  disable: false,
  update: false,
  repair: false,
  remove: false,
};

const GATEWAY_LIFECYCLE: ExtensionLifecycle = {
  install: true,
  configure: true,
  enable: false,
  disable: false,
  update: true,
  repair: true,
  remove: true,
};

function statusDiagnostics(status: ExtensionStatus): ExtensionDiagnostic[] {
  if (!status.error) return [];
  return [{
    code: "LEGACY_CHECK_FAILED",
    severity: "error",
    message: status.error,
  }];
}

function installedState(status: ExtensionStatus) {
  return status.installed
    ? { version: status.version ?? null, enabled: true }
    : null;
}

function display(meta: ExtensionMetadata, iconKey: string) {
  return {
    name: meta.name,
    ...(meta.nameKey ? { nameKey: meta.nameKey } : {}),
    description: meta.description,
    ...(meta.descriptionKey ? { descriptionKey: meta.descriptionKey } : {}),
    homepage: meta.homepageUrl,
    iconKey,
  };
}

export function projectLegacyExtension(
  meta: ExtensionMetadata,
  status: ExtensionStatus,
): ExtensionInventoryItem {
  const diagnostics = statusDiagnostics(status);
  const health = diagnostics.length > 0
    ? "error" as const
    : status.installed
      ? "ready" as const
      : "unknown" as const;

  if (meta.id === "rg") {
    return {
      id: "system.ripgrep",
      legacyIds: ["rg"],
      kind: "system-dependency",
      display: display(meta, "search"),
      source: { type: "system", trust: "tower" },
      installed: installedState(status),
      available: null,
      compatibility: "compatible",
      health,
      capabilities: ["code-search"],
      permissions: [],
      lifecycle: SYSTEM_LIFECYCLE,
      diagnostics,
    };
  }

  if (meta.id === "monaco") {
    return {
      id: "tower.monaco",
      legacyIds: ["monaco"],
      kind: "tower-component",
      display: display(meta, "file-code"),
      source: { type: "builtin", publisherId: "tower", trust: "tower" },
      installed: installedState(status),
      available: null,
      compatibility: "compatible",
      health,
      capabilities: ["code-editor"],
      permissions: [],
      lifecycle: {
        ...COMPONENT_LIFECYCLE,
        install: !meta.manualInstall,
      },
      diagnostics,
    };
  }

  if (meta.id !== "tower-agent-openclaw" && meta.id !== "tower-agent-hermes") {
    const unsupportedId: never = meta.id;
    throw new Error(`Unsupported legacy extension: ${String(unsupportedId)}`);
  }
  const targetId = meta.id === "tower-agent-openclaw" ? "openclaw" : "hermes";
  return {
    id: "tower.gateway-agent",
    legacyIds: [meta.id],
    kind: "gateway-adapter",
    display: {
      name: "Tower Gateway Agent",
      nameKey: "settings.extensions.gatewayAgent.name",
      description: "Deploy Tower MCP, skills, and profile resources to a supported gateway",
      descriptionKey: "settings.extensions.gatewayAgent.description",
      iconKey: "radio-tower",
    },
    source: { type: "builtin", publisherId: "tower", trust: "tower" },
    installed: installedState(status),
    available: null,
    compatibility: "compatible",
    health,
    capabilities: ["tower-gateway"],
    permissions: [],
    lifecycle: GATEWAY_LIFECYCLE,
    deployments: [{
      targetId,
      installed: status.installed,
      health,
      ...(status.version ? { version: status.version } : {}),
      diagnostics,
    }],
    diagnostics,
  };
}

export function mergeLegacyInventory(
  items: ExtensionInventoryItem[],
): ExtensionInventoryItem[] {
  const byId = new Map<string, ExtensionInventoryItem>();

  for (const item of items) {
    const current = byId.get(item.id);
    if (!current) {
      byId.set(item.id, structuredClone(item));
      continue;
    }

    const deployments = [
      ...(current.deployments ?? []),
      ...(item.deployments ?? []),
    ].sort((left, right) => left.targetId.localeCompare(right.targetId));
    const installed = deployments.some((deployment) => deployment.installed);
    const hasError = deployments.some((deployment) => deployment.health === "error");
    const isReady = deployments.some((deployment) => deployment.health === "ready");

    byId.set(item.id, {
      ...current,
      legacyIds: [...new Set([...(current.legacyIds ?? []), ...(item.legacyIds ?? [])])],
      installed: installed ? { version: null, enabled: true } : null,
      health: hasError && isReady ? "degraded" : hasError ? "error" : isReady ? "ready" : "unknown",
      deployments,
      diagnostics: [...current.diagnostics, ...item.diagnostics],
    });
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}
