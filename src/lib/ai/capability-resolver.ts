import "server-only";

import {
  CapabilityRuntimeError,
  PluginRuntimeError,
  capabilityError,
  type AiCapabilitySlot,
  type CapabilityErrorShape,
  type CapabilityTarget,
} from "@tower-org/ai-runtime";
import type { CliAdapter } from "@tower-org/ai-sdk";
import { db } from "@/lib/db";
import { providerRegistry } from "./providers";
import { AiProviderError } from "./types";
import type { AiQueryAdapter, ProviderDefinition } from "./types";
import { getApiRuntimeService } from "./api-connection-service";

export interface ResolvedCapabilityTarget extends CapabilityTarget {
  kind: "cli" | "api";
  provider: string;
  connectionName: string;
  cli?: {
    adapter: CliAdapter;
    provider: ProviderDefinition;
    commandPath: string;
  };
  api?: {
    protocol: string;
  };
}

export interface ResolvedCapabilityPlan {
  slot: AiCapabilitySlot;
  targets: ResolvedCapabilityTarget[];
  migrationStatus: string;
}

interface ResolveOptions {
  cwd?: string;
  targetId?: string | null;
}

const connectionSelect = {
  id: true,
  name: true,
  kind: true,
  provider: true,
  enabled: true,
  testStatus: true,
  testOk: true,
  commandOverride: true,
  baseArgsJson: true,
  envVarsJson: true,
  settingsJson: true,
  models: { select: { modelId: true, available: true } },
  apiKeys: { select: { enabled: true, testStatus: true } },
} as const;

function preflight(code: CapabilityErrorShape["code"]): CapabilityErrorShape {
  const error = capabilityError(code);
  return { code: error.code, message: error.message };
}

function cliResolutionErrorCode(error: unknown): CapabilityErrorShape["code"] {
  if (error instanceof PluginRuntimeError) {
    if (error.code === "PLUGIN_DISABLED") return "connection_disabled";
    if (error.code === "PLUGIN_NOT_FOUND") return "cli_not_found";
    return "connection_unavailable";
  }
  if (!(error instanceof Error)) return "cli_not_found";
  if (error.message === "plugin_disabled") return "connection_disabled";
  if (error.message === "plugin_corrupt") return "connection_unavailable";
  if (error.message === "plugin_not_found" || error.message === "cli_not_found") return "cli_not_found";
  if (error.message === "cli_not_executable") return "cli_not_executable";
  return error.message.includes("not runnable") ? "cli_not_executable" : "cli_not_found";
}

async function resolveStoredTarget(
  target: {
    id: string;
    connectionId: string;
    modelId: string | null;
    order: number;
    connection: {
      id: string;
      name: string;
      kind: string;
      provider: string;
      enabled: boolean;
      testStatus: string;
      testOk: boolean;
      commandOverride: string | null;
      baseArgsJson: string;
      envVarsJson: string;
      settingsJson: string;
      models: Array<{ modelId: string; available: boolean }>;
      apiKeys: Array<{ enabled: boolean; testStatus: string }>;
    };
  },
  options: ResolveOptions,
): Promise<ResolvedCapabilityTarget> {
  const connection = target.connection;
  const base = {
    targetId: target.id,
    connectionId: target.connectionId,
    ...(target.modelId ? { modelId: target.modelId } : {}),
    order: target.order,
    provider: connection.provider,
    connectionName: connection.name,
  };
  if (connection.kind !== "cli" && connection.kind !== "api") {
    return { ...base, kind: "cli", preflightError: preflight("connection_unavailable") };
  }
  if (!connection.enabled) {
    return { ...base, kind: connection.kind, preflightError: preflight("connection_disabled") };
  }
  if (!connection.testOk || connection.testStatus === "unavailable") {
    return { ...base, kind: connection.kind, preflightError: preflight("connection_unavailable") };
  }
  if (connection.kind === "cli" && connection.testStatus !== "connected") {
    return { ...base, kind: "cli", preflightError: preflight("connection_unavailable") };
  }

  if (connection.kind === "api") {
    if (!target.modelId) {
      return { ...base, kind: "api", preflightError: preflight("invalid_request") };
    }
    const knownModel = connection.models.find((model) => model.modelId === target.modelId);
    if (knownModel && !knownModel.available) {
      return { ...base, kind: "api", preflightError: preflight("model_unavailable") };
    }
    const configuredKeys = connection.apiKeys.length;
    const healthyKeys = connection.apiKeys.filter((key) => key.enabled && key.testStatus === "ok").length;
    if (configuredKeys > 0 && healthyKeys === 0) {
      return { ...base, kind: "api", preflightError: preflight("authentication") };
    }
    return { ...base, kind: "api", api: { protocol: connection.provider } };
  }

  try {
    const resolved = await providerRegistry.createResolvedCliConnectionAdapter(
      connection,
      options.cwd ?? process.cwd(),
    );
    if (!resolved) return { ...base, kind: "cli", preflightError: preflight("cli_not_found") };
    const resolvedProvider = resolved.provider ?? providerRegistry.get(connection.provider);
    if (!resolvedProvider) return { ...base, kind: "cli", preflightError: preflight("cli_not_found") };
    return {
      ...base,
      kind: "cli",
      cli: { adapter: resolved.adapter, provider: resolvedProvider, commandPath: resolved.commandPath },
    };
  } catch (error) {
    return { ...base, kind: "cli", preflightError: preflight(cliResolutionErrorCode(error)) };
  }
}

export async function resolveCapabilityPlan(
  slot: AiCapabilitySlot,
  options: ResolveOptions = {},
): Promise<ResolvedCapabilityPlan> {
  const config = await db.aiCapabilityConfig.findUnique({
    where: { slot },
    include: {
      targets: {
        include: { connection: { select: connectionSelect } },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!config || config.targets.length === 0) {
    throw capabilityError("slot_unconfigured");
  }
  const targets: ResolvedCapabilityTarget[] = [];
  for (const target of config.targets) targets.push(await resolveStoredTarget(target, options));
  return { slot, targets, migrationStatus: config.migrationStatus };
}

export async function resolveTerminalTargetPlan(options: ResolveOptions = {}) {
  return resolveCapabilityPlan("terminal", options);
}

export async function getApiRuntimeForResolvedTarget(target: ResolvedCapabilityTarget) {
  if (target.kind !== "api" || !target.api || target.preflightError) {
    throw capabilityError(target.preflightError?.code ?? "invalid_request");
  }
  return getApiRuntimeService(target.connectionId);
}

export async function resolveFixedCliConnection(
  connectionId: string,
  modelId: string | null = null,
  options: ResolveOptions = {},
): Promise<ResolvedCapabilityTarget> {
  const connection = await db.providerConnection.findUnique({
    where: { id: connectionId },
    select: connectionSelect,
  });
  if (!connection || connection.kind !== "cli") throw capabilityError("connection_unavailable");
  return resolveStoredTarget({
    id: options.targetId ?? `fixed:${connection.id}`,
    connectionId: connection.id,
    modelId,
    order: 0,
    connection,
  }, options);
}

export async function resolveLegacyExecutionCliConnection(
  agent: string,
  options: ResolveOptions = {},
): Promise<ResolvedCapabilityTarget> {
  const providers = providerRegistry.getAll().filter((provider) =>
    provider.cli && provider.agentFieldValue === agent
  );
  if (providers.length !== 1) throw capabilityError("connection_unavailable");
  const provider = providers[0]!;
  const connection = await db.providerConnection.findUnique({
    where: { connectionKey: `cli:${provider.name}` },
    select: connectionSelect,
  });
  if (!connection || connection.kind !== "cli") throw capabilityError("connection_unavailable");
  return resolveStoredTarget({
    id: options.targetId ?? `legacy:${connection.id}`,
    connectionId: connection.id,
    modelId: null,
    order: 0,
    connection,
  }, options);
}

function throwLegacyResolutionError(target: ResolvedCapabilityTarget): never {
  const code = target.preflightError?.code ?? "connection_unavailable";
  const legacyCode = code === "model_unavailable"
    ? "MODEL_NOT_AVAILABLE"
    : code === "cli_not_executable"
      ? "SPAWN_FAILED"
      : "CLI_NOT_FOUND";
  throw new AiProviderError(
    legacyCode,
    target.provider,
    target.preflightError?.message ?? "The configured capability target is unavailable",
  );
}

async function resolveLegacyFixedCli(value: string): Promise<ResolvedCapabilityTarget> {
  const connection = await db.providerConnection.findFirst({
    where: { OR: [{ id: value }, { connectionKey: `cli:${value}` }], kind: "cli" },
    select: connectionSelect,
  });
  if (!connection) throw new AiProviderError("CLI_NOT_FOUND", value, "The fixed CLI connection no longer exists");
  return resolveStoredTarget({
    id: `fixed:${connection.id}`,
    connectionId: connection.id,
    modelId: null,
    order: 0,
    connection,
  }, {});
}

export async function resolveCliAdapter(
  slot: "terminal",
  fixedConnectionOrLegacyProvider?: string,
): Promise<{ adapter: CliAdapter; provider: ProviderDefinition; model?: string; connectionId: string; targetId: string }> {
  const target = fixedConnectionOrLegacyProvider
    ? await resolveLegacyFixedCli(fixedConnectionOrLegacyProvider)
    : (await resolveCapabilityPlan(slot)).targets[0]!;
  if (target.preflightError || !target.cli) throwLegacyResolutionError(target);
  return {
    adapter: target.cli.adapter,
    provider: target.cli.provider,
    ...(target.modelId ? { model: target.modelId } : {}),
    connectionId: target.connectionId,
    targetId: target.targetId,
  };
}

export async function resolveQueryAdapter(
  slot: "summary" | "dreaming" | "analysis" | "assistant",
): Promise<{ adapter: AiQueryAdapter; provider: ProviderDefinition; model?: string; connectionId: string; targetId: string }> {
  const target = (await resolveCapabilityPlan(slot)).targets[0]!;
  if (target.preflightError) throwLegacyResolutionError(target);
  if (!target.cli) {
    throw new AiProviderError(
      "UNSUPPORTED_MODE",
      target.provider,
      "This legacy query entry point cannot execute an API connection; use the resolved capability target runtime",
    );
  }
  const adapter = target.cli.provider.cliQuery?.adapter
    ?? providerRegistry.getQueryAdapter(target.provider, "cli");
  if (!adapter) {
    throw new AiProviderError("UNSUPPORTED_MODE", target.provider, "The configured CLI has no query adapter");
  }
  return {
    adapter,
    provider: target.cli.provider,
    ...(target.modelId ? { model: target.modelId } : {}),
    connectionId: target.connectionId,
    targetId: target.targetId,
  };
}

export function isSlotUnconfiguredError(error: unknown): boolean {
  return error instanceof CapabilityRuntimeError && error.code === "slot_unconfigured";
}
