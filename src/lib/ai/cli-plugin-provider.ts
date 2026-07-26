import "server-only";

import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  CommandResolver,
  evaluateCliDependency,
  PluginRuntimeError,
  stableJson,
  type CommandResolution,
  validatePluginSettings,
} from "@tower-org/ai-runtime";
import type {
  CliAdapter,
  CliConfigSchema,
  CliPlugin,
  CliProcessSpec,
  PlatformName,
} from "@tower-org/ai-sdk";
import { db } from "@/lib/db";
import { getTowerDir } from "@/lib/tower-dir";
import {
  getCliPluginApplication,
  type CliEnvironmentVariable,
  type CliPluginApplicationErrorCode,
} from "./cli-plugin-service";
import { CliPluginApplicationError } from "./cli-plugin-service";
import {
  createProviderHostContext,
  mergeProviderProcess,
  providerBaseEnvironment,
} from "./provider-host";
import type { AiQueryAdapter, ProviderDefinition } from "./types";

export interface CliPluginConnectionRecord {
  id: string;
  provider: string;
  enabled: boolean;
  commandOverride: string | null;
  baseArgsJson: string;
  envVarsJson: string;
  settingsJson: string;
}

export interface ResolvedPluginCli {
  adapter: CliAdapter;
  provider: ProviderDefinition;
  manifest: CliPlugin["manifest"];
  commandPath: string;
  version: string | null;
  providerVersion: string;
  connectionId: string;
  configurationDigest: string;
  dependency: ReturnType<typeof evaluateCliDependency>;
  resolution: CommandResolution;
}

interface ResolvePluginOptions {
  signal?: AbortSignal;
  hello?: boolean;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function pluginStorageDir(pluginId: string): string {
  const key = createHash("sha256").update(pluginId).digest("hex").slice(0, 32);
  return path.join(getTowerDir(), "ai", "plugin-storage", key);
}

function enabledEnvironment(entries: CliEnvironmentVariable[]): Record<string, string> {
  return Object.fromEntries(entries
    .filter((entry) => entry.enabled && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name))
    .map((entry) => [entry.name, entry.value]));
}

function providerConfigDir(defaultCommand: string): string {
  const name = defaultCommand.split(/[\\/]/).at(-1)?.replace(/\.(?:cmd|exe|bat)$/i, "") ?? "cli";
  return path.join(os.homedir(), `.${name.replace(/[^a-z0-9._-]/gi, "-")}`);
}

function configurationDigest(
  connection: CliPluginConnectionRecord,
  schema: CliConfigSchema,
  settings: Record<string, unknown>,
  environment: CliEnvironmentVariable[],
): string {
  const safeSettings = Object.fromEntries(Object.entries(settings)
    .filter(([key]) => schema.properties?.[key]?.["x-tower"]?.sensitive !== true));
  const safeEnvironment = environment
    .map(({ name, enabled }) => ({ name, enabled }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const baseArgShape = parseJson<string[]>(connection.baseArgsJson, [])
    .map((argument) => argument.startsWith("-") ? argument.split("=", 1)[0] : "<value>");
  return createHash("sha256").update(stableJson({
    commandOverride: connection.commandOverride,
    baseArgShape,
    environment: safeEnvironment,
    settings: safeSettings,
  })).digest("hex");
}

function wrapConnectionAdapter(
  adapter: CliAdapter,
  commandPath: string,
  baseArgs: string[],
  envPatch: Record<string, string>,
): CliAdapter {
  const merge = (spec: CliProcessSpec) => mergeProviderProcess(spec, commandPath, {
    baseArgs,
    envPatch,
  });
  return {
    buildSessionProcess: (options) => merge(adapter.buildSessionProcess(options)),
    ...(adapter.buildHelloProbe
      ? { buildHelloProbe: (options) => merge(adapter.buildHelloProbe!(options)) }
      : {}),
    ...(adapter.classifySessionFailure
      ? { classifySessionFailure: (input) => adapter.classifySessionFailure!(input) }
      : {}),
    generate: (options) => adapter.generate(options),
    ...(adapter.stream ? { stream: (options) => adapter.stream!(options) } : {}),
    models: () => adapter.models(),
    ...(adapter.mcp ? { mcp: adapter.mcp } : {}),
    ...(adapter.hooks ? { hooks: adapter.hooks } : {}),
    ...(adapter.skills ? { skills: adapter.skills } : {}),
  };
}

export function cliAdapterAsQueryAdapter(adapter: CliAdapter): AiQueryAdapter {
  return {
    async query(options) {
      const result = await adapter.generate(options);
      return {
        content: result.text,
        ...(result.usage ? {
          usage: {
            inputTokens: result.usage.inputTokens ?? 0,
            outputTokens: result.usage.outputTokens ?? 0,
          },
        } : {}),
      };
    },
    async *queryStream(options) {
      if (!adapter.stream) {
        const result = await adapter.generate(options);
        if (result.text) yield { type: "text" as const, content: result.text };
        return;
      }
      for await (const event of adapter.stream(options)) {
        if (event.type === "text") yield { type: "text" as const, content: event.text };
        if (event.type === "reasoning") yield { type: "text" as const, content: event.text };
        if (event.type === "error") yield { type: "error" as const, content: event.error.message };
      }
    },
    isAvailable: async () => true,
    getModels: async () => (await adapter.models()).map((model) => model.id),
  };
}

export async function resolvePluginCliConnection(
  connection: CliPluginConnectionRecord,
  cwd: string,
  options: ResolvePluginOptions = {},
): Promise<ResolvedPluginCli> {
  if (!connection.enabled) throw new Error("plugin_disabled");
  const application = getCliPluginApplication();
  const registration = await application.runtime.get(connection.provider);
  if (!registration) throw new Error("plugin_not_found");
  if (!registration.enabled) throw new Error("plugin_disabled");
  const inspected = await application.runtime.inspect(connection.provider);
  const settings = validatePluginSettings(
    inspected.configSchema,
    parseJson(connection.settingsJson, {}),
    { applyDefaults: true },
  );
  const baseArgs = parseJson<string[]>(connection.baseArgsJson, []);
  const environmentEntries = parseJson<CliEnvironmentVariable[]>(connection.envVarsJson, []);
  const envPatch = enabledEnvironment(environmentEntries);
  const environment = { ...providerBaseEnvironment(connection.provider), ...envPatch };
  const signal = options.signal ?? new AbortController().signal;
  const allowsProviderConfig = registration.permissions.includes("filesystem:provider-config");
  const makeHost = (commandPath?: string) => createProviderHostContext(
    connection.provider,
    commandPath,
    signal,
    {
      baseArgs,
      envOverrides: envPatch,
      storageDir: pluginStorageDir(connection.provider),
      providerConfigDir: allowsProviderConfig
        ? providerConfigDir(inspected.manifest.command.default)
        : null,
    },
  );

  const resolver = new CommandResolver({
    platform: process.platform as PlatformName,
    env: environment,
  });
  const resolutionRequest = {
    commandOverride: connection.commandOverride ?? undefined,
    defaultCommand: inspected.manifest.command.default,
    aliases: inspected.manifest.command.aliases,
    knownPaths: inspected.manifest.command.knownPaths?.[process.platform as PlatformName],
    versionArgs: inspected.manifest.command.versionArgs,
    cwd,
    env: environment,
    signal,
    cacheKey: connection.id,
  };
  let resolution = await resolver.resolve(resolutionRequest);
  let selected = resolution.selected;
  if (!selected || selected.state === "not-found") throw new Error("cli_not_found");
  if (selected.state === "found") throw new Error("cli_not_executable");
  const dependency = evaluateCliDependency(inspected.manifest, selected.path, selected.version);
  if (dependency.state !== "ready") throw new Error("cli_dependency_incompatible");

  if (options.hello) {
    const probeAdapter = await application.runtime.load(connection.provider, makeHost(selected.path), settings);
    if (!probeAdapter.buildHelloProbe) throw new Error("probe_failed");
    resolution = await resolver.resolve({
      ...resolutionRequest,
      commandOverride: selected.path,
      helloProbe: (candidate) => mergeProviderProcess(
        probeAdapter.buildHelloProbe!({
          command: candidate.path,
          cwd,
          prompt: "Respond with just the word hello",
        }),
        candidate.path,
        { baseArgs, envPatch },
      ),
      helloTimeoutMs: 45_000,
    });
    selected = resolution.selected;
    if (!selected || selected.state !== "connected") throw new Error("probe_failed");
  }

  const adapter = await application.runtime.load(connection.provider, makeHost(selected.path), settings);
  const managedAdapter = wrapConnectionAdapter(adapter, selected.path, baseArgs, envPatch);
  const plugin: CliPlugin = {
    manifest: inspected.manifest,
    createAdapter: () => managedAdapter,
  };
  const provider: ProviderDefinition = {
    name: connection.provider,
    displayName: inspected.manifest.display.name,
    version: registration.version,
    agentFieldValue: "CLI_PLUGIN",
    builtin: false,
    cli: {
      command: inspected.manifest.command.default,
      plugin,
      adapter: managedAdapter,
    },
    cliQuery: { adapter: cliAdapterAsQueryAdapter(managedAdapter) },
    models: { cli: [], api: [] },
  };
  return {
    adapter: managedAdapter,
    provider,
    manifest: inspected.manifest,
    commandPath: selected.path,
    version: selected.version,
    providerVersion: registration.version,
    connectionId: connection.id,
    configurationDigest: configurationDigest(connection, inspected.configSchema, settings, environmentEntries),
    dependency,
    resolution,
  };
}

export async function testPluginCliConnection(pluginId: string, signal?: AbortSignal) {
  const connection = await db.providerConnection.findUnique({
    where: { connectionKey: `cli:${pluginId}` },
    select: {
      id: true,
      provider: true,
      enabled: true,
      commandOverride: true,
      baseArgsJson: true,
      envVarsJson: true,
      settingsJson: true,
    },
  });
  if (!connection) throw new Error("plugin_not_found");
  try {
    const resolved = await resolvePluginCliConnection(connection, process.cwd(), { hello: true, signal });
    const models = await resolved.adapter.models().catch(() => []);
    const discoveredAt = new Date();
    await db.$transaction(async (transaction) => {
      await transaction.apiConnectionModel.updateMany({
        where: { connectionId: connection.id, source: "discovered" },
        data: { available: false },
      });
      for (const model of models.slice(0, 1_000)) {
        if (!model.id.trim() || model.id.length > 300) continue;
        await transaction.apiConnectionModel.upsert({
          where: { connectionId_modelId: { connectionId: connection.id, modelId: model.id } },
          create: {
            connectionId: connection.id,
            modelId: model.id,
            source: "discovered",
            available: true,
            lastDiscoveredAt: discoveredAt,
          },
          update: {
            source: "discovered",
            available: true,
            lastDiscoveredAt: discoveredAt,
          },
        });
      }
      await transaction.providerConnection.update({
        where: { id: connection.id },
        data: {
          testStatus: "connected",
          testOk: true,
          lastTestedAt: discoveredAt,
          resolvedCommand: resolved.commandPath,
          resolvedVersion: resolved.version,
          diagnosticsJson: JSON.stringify({ code: "ok", state: resolved.resolution.state }),
        },
      });
    });
    return {
      state: resolved.resolution.state,
      command: resolved.commandPath,
      version: resolved.version,
      candidates: resolved.resolution.candidates.map((candidate) => ({
        path: candidate.path,
        state: candidate.state,
        version: candidate.version,
        source: candidate.locationSource,
      })),
      models: models.map((model) => model.id),
    };
  } catch (error) {
    const code: CliPluginApplicationErrorCode = error instanceof PluginRuntimeError
      ? error.code === "PLUGIN_DISABLED" ? "plugin_disabled"
        : error.code === "PLUGIN_NOT_FOUND" ? "plugin_not_found"
          : "plugin_corrupt"
      : error instanceof Error && error.message === "cli_dependency_incompatible" ? "cli_incompatible"
        : error instanceof Error && [
      "plugin_disabled", "plugin_not_found", "cli_not_found", "cli_not_executable", "probe_failed",
    ].includes(error.message) ? error.message as CliPluginApplicationErrorCode : "probe_failed";
    await db.providerConnection.update({
      where: { id: connection.id },
      data: {
        testStatus: code === "cli_not_found" ? "dependency-missing"
          : code === "cli_incompatible" ? "dependency-incompatible" : "unavailable",
        testOk: false,
        lastTestedAt: new Date(),
        diagnosticsJson: JSON.stringify({ code }),
      },
    });
    throw new CliPluginApplicationError(code);
  }
}
