import { createHash } from "node:crypto";
import type { CliAdapter as SdkCliAdapter, CliPluginManifestV1 } from "@tower/ai-sdk";
import { evaluateCliDependency, stableJson, type CliDependencyDiagnostic } from "@tower/ai-runtime";
import type { AiQueryAdapter, ProviderDefinition, ProviderAvailability } from "./types";
import { db } from "@/lib/db";
import { getCliPluginApplication } from "./cli-plugin-service";
import { resolvePluginCliConnection, type CliPluginConnectionRecord } from "./cli-plugin-provider";
import {
  createBuiltInAdapter,
  resolveBuiltInCommandResolution,
} from "./provider-host";

function declaredIntegrations(capabilities: {
  integrations?: { mcp?: boolean; hooks?: boolean; skills?: boolean };
} | null | undefined): ProviderAvailability["cli"]["integrations"] {
  return {
    mcp: capabilities?.integrations?.mcp === true,
    hooks: capabilities?.integrations?.hooks === true,
    skills: capabilities?.integrations?.skills === true,
  };
}

export interface CliProviderRegistration {
  id: string;
  displayName: string;
  providerVersion: string;
  builtin: boolean;
  enabled: boolean;
  permissionConfirmed: boolean;
  health: "ready" | "disabled" | "corrupt";
  connectionId: string | null;
  integrations: ProviderAvailability["cli"]["integrations"];
}

export interface ResolvedCliProvider {
  adapter: SdkCliAdapter;
  provider: ProviderDefinition;
  manifest: CliPluginManifestV1;
  providerVersion: string;
  commandPath: string;
  version: string | null;
  connectionId: string | null;
  configurationDigest: string;
  dependency: CliDependencyDiagnostic;
}

function digestConfiguration(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export class ProviderRegistry {
  private providers = new Map<string, ProviderDefinition>();

  register(provider: ProviderDefinition): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): ProviderDefinition | undefined {
    return this.providers.get(name);
  }

  getAll(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  /** Enumerate executable CLI providers without loading third-party adapter code. */
  async listCliProviders(): Promise<CliProviderRegistration[]> {
    const builtIns: CliProviderRegistration[] = this.getAll()
      .filter((provider) => provider.cli)
      .map((provider) => ({
        id: provider.name,
        displayName: provider.displayName,
        providerVersion: provider.version ?? "builtin",
        builtin: provider.builtin === true,
        enabled: true,
        permissionConfirmed: true,
        health: "ready",
        connectionId: null,
        integrations: declaredIntegrations(provider.cli?.plugin.manifest.capabilities),
      }));
    const [plugins, connections] = await Promise.all([
      getCliPluginApplication().list(),
      db.providerConnection.findMany({
        where: { kind: "cli" },
        select: { id: true, provider: true, enabled: true },
      }),
    ]);
    const connectionsByProvider = new Map(connections.map((connection) => [connection.provider, connection]));
    const dynamic = plugins
      .filter((plugin) => plugin.enabled && plugin.permissionConfirmed && plugin.health === "ready")
      .flatMap((plugin): CliProviderRegistration[] => {
        const connection = connectionsByProvider.get(plugin.id);
        if (!connection?.enabled || this.providers.has(plugin.id)) return [];
        return [{
          id: plugin.id,
          displayName: plugin.displayName,
          providerVersion: plugin.version,
          builtin: false,
          enabled: true,
          permissionConfirmed: true,
          health: "ready",
          connectionId: connection.id,
          integrations: declaredIntegrations(plugin.capabilities),
        }];
      });
    return [...builtIns, ...dynamic];
  }

  getCliAdapter(name: string): SdkCliAdapter | null {
    return this.providers.get(name)?.cli?.adapter ?? null;
  }

  getByAgentFieldValue(agent: string): ProviderDefinition | undefined {
    return this.getAll().find((provider) => provider.agentFieldValue === agent);
  }

  async createResolvedCliAdapter(
    name: string,
    cwd: string,
    commandOverride?: string,
  ): Promise<ResolvedCliProvider | null> {
    const provider = this.providers.get(name);
    if (provider?.cli) {
      const spec = { id: provider.name, agentFieldValue: provider.agentFieldValue, plugin: provider.cli.plugin };
      const resolution = await resolveBuiltInCommandResolution(spec, cwd, commandOverride);
      if (!resolution.selected || resolution.selected.state === "not-found") {
        throw new Error(`${spec.plugin.manifest.display.name} CLI was not found`);
      }
      if (resolution.selected.state === "found") {
        throw new Error(`${spec.plugin.manifest.display.name} CLI is not runnable`);
      }
      const commandPath = resolution.selected.path;
      const dependency = evaluateCliDependency(
        spec.plugin.manifest,
        commandPath,
        resolution.selected.version,
      );
      if (dependency.state !== "ready") throw new Error("cli_dependency_incompatible");
      return {
        adapter: createBuiltInAdapter(spec, commandPath),
        provider,
        manifest: spec.plugin.manifest,
        providerVersion: provider.version ?? "builtin",
        commandPath,
        version: resolution.selected.version ?? null,
        connectionId: null,
        configurationDigest: digestConfiguration({ commandOverride: commandOverride ?? null }),
        dependency,
      };
    }
    const connection = await db.providerConnection.findUnique({
      where: { connectionKey: `cli:${name}` },
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
    if (!connection) return null;
    return resolvePluginCliConnection(
      { ...connection, commandOverride: commandOverride ?? connection.commandOverride } as CliPluginConnectionRecord,
      cwd,
    );
  }

  async createResolvedCliConnectionAdapter(
    connection: CliPluginConnectionRecord,
    cwd: string,
  ): Promise<ResolvedCliProvider | null> {
    const provider = this.providers.get(connection.provider);
    if (!provider?.cli) return resolvePluginCliConnection(connection, cwd);
    const resolved = await this.createResolvedCliAdapter(
      connection.provider,
      cwd,
      connection.commandOverride ?? undefined,
    );
    return resolved ? {
      ...resolved,
      connectionId: connection.id,
      configurationDigest: digestConfiguration({
        commandOverride: connection.commandOverride,
        baseArgShape: (() => {
          try {
            const args = JSON.parse(connection.baseArgsJson) as unknown;
            return Array.isArray(args)
              ? args.map((argument) => typeof argument === "string" && argument.startsWith("-")
                ? argument.split("=", 1)[0]
                : "<value>")
              : [];
          } catch {
            return [];
          }
        })(),
        environmentNames: (() => {
          try {
            const entries = JSON.parse(connection.envVarsJson) as Array<{ name?: unknown; enabled?: unknown }>;
            return entries.map((entry) => ({
              name: typeof entry.name === "string" ? entry.name : "",
              enabled: entry.enabled === true,
            })).sort((left, right) => left.name.localeCompare(right.name));
          } catch {
            return [];
          }
        })(),
      }),
    } : null;
  }

  getQueryAdapter(name: string, mode: "api" | "cli"): AiQueryAdapter | null {
    const provider = this.providers.get(name);
    if (!provider) return null;
    if (mode === "api") return provider.api?.adapter ?? null;
    return provider.cliQuery?.adapter ?? null;
  }

  getAllowedCommands(): string[] {
    const commands: string[] = [];
    for (const p of this.providers.values()) {
      if (p.cli?.command) commands.push(p.cli.command);
    }
    return commands;
  }

  /** Return static built-in definitions without touching the file system or spawning CLIs. */
  getRegisteredProviders(): ProviderAvailability[] {
    return this.getAll().map((provider) => {
      const apiKeyConfigured = provider.api ? Boolean(process.env[provider.api.keyEnvVar]) : false;
      return {
        name: provider.name,
        displayName: provider.displayName,
        builtin: provider.builtin === true,
        cli: {
          available: false,
          version: null,
          commandPath: null,
          commandState: null,
          integrations: declaredIntegrations(provider.cli?.plugin.manifest.capabilities),
          connectionStatus: "untested",
        },
        api: { available: apiKeyConfigured, keyConfigured: apiKeyConfigured },
      };
    });
  }

  async getAvailableProviders(): Promise<ProviderAvailability[]> {
    const results: ProviderAvailability[] = [];
    for (const p of this.providers.values()) {
      let cliAvailable = false;
      let cliVersion: string | null = null;
      let commandPath: string | null = null;
      let commandState: ProviderAvailability["cli"]["commandState"] = null;
      let connectionStatus: ProviderAvailability["cli"]["connectionStatus"];
      if (p.cli) {
        try {
          const spec = { id: p.name, agentFieldValue: p.agentFieldValue, plugin: p.cli.plugin };
          const resolution = await resolveBuiltInCommandResolution(spec, process.cwd());
          cliVersion = resolution.selected?.version ?? null;
          commandPath = resolution.selected?.path ?? null;
          commandState = resolution.selected?.state ?? resolution.state;
          const runnable = resolution.selected?.state === "runnable"
            || resolution.selected?.state === "connected";
          if (runnable && resolution.selected) {
            const dependency = evaluateCliDependency(
              p.cli.plugin.manifest,
              resolution.selected.path,
              resolution.selected.version,
            );
            cliAvailable = dependency.state === "ready";
            if (!cliAvailable) connectionStatus = "dependencyIncompatible";
          } else {
            connectionStatus = "dependencyMissing";
          }
        } catch {
          cliAvailable = false;
          commandState = "not-found";
          connectionStatus = "dependencyMissing";
        }
      }
      const apiKeyConfigured = p.api ? !!process.env[p.api.keyEnvVar] : false;
      const apiAvailable = p.api ? apiKeyConfigured : false;

      results.push({
        name: p.name,
        displayName: p.displayName,
        builtin: p.builtin === true,
        cli: {
          available: cliAvailable,
          version: cliVersion,
          commandPath,
          commandState,
          ...(connectionStatus ? { connectionStatus } : {}),
          integrations: declaredIntegrations(p.cli?.plugin.manifest.capabilities),
        },
        api: { available: apiAvailable, keyConfigured: apiKeyConfigured },
      });
    }
    const [plugins, connections] = await Promise.all([
      getCliPluginApplication().list(),
      db.providerConnection.findMany({
        where: { kind: "cli" },
        select: {
          name: true,
          provider: true,
          enabled: true,
          testOk: true,
          resolvedCommand: true,
          resolvedVersion: true,
          testStatus: true,
        },
      }),
    ]);
    const connectionsByProvider = new Map(connections.map((connection) => [connection.provider, connection]));
    for (const plugin of plugins) {
      if (this.providers.has(plugin.id)) continue;
      const connection = connectionsByProvider.get(plugin.id);
      const connectionStatus: NonNullable<ProviderAvailability["cli"]["connectionStatus"]> =
        plugin.health === "corrupt" ? "pluginDamaged"
          : !plugin.permissionConfirmed ? "permissionRequired"
              : !plugin.enabled || connection?.enabled === false ? "pluginDisabled"
              : connection?.testStatus === "dependency-missing" ? "dependencyMissing"
                : connection?.testStatus === "dependency-incompatible" ? "dependencyIncompatible"
                  : connection?.testOk ? "connected"
                : connection?.testStatus === "unavailable" ? "unavailable"
                  : "untested";
      results.push({
        name: plugin.id,
        displayName: plugin.displayName,
        builtin: false,
        cli: {
          available: Boolean(plugin.enabled && plugin.health === "ready" && connection?.enabled && connection.testOk),
          version: connection?.resolvedVersion ?? null,
          commandPath: connection?.resolvedCommand ?? null,
          commandState: connection?.testOk
            ? "connected"
            : connection?.resolvedCommand ? "found" : null,
          integrations: declaredIntegrations(plugin.capabilities),
          connectionStatus,
        },
        api: { available: false, keyConfigured: false },
      });
    }
    for (const connection of connections) {
      if (this.providers.has(connection.provider)
        || plugins.some((plugin) => plugin.id === connection.provider)) continue;
      results.push({
        name: connection.provider,
        displayName: connection.name,
        builtin: false,
        cli: {
          available: false,
          version: connection.resolvedVersion,
          commandPath: connection.resolvedCommand,
          commandState: connection.resolvedCommand ? "found" : null,
          integrations: declaredIntegrations(null),
          connectionStatus: "pluginUninstalled",
        },
        api: { available: false, keyConfigured: false },
      });
    }
    return results;
  }
}
