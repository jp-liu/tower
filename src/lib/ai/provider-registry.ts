import type { CliAdapter as SdkCliAdapter } from "@tower/ai-sdk";
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
  ): Promise<{
    adapter: SdkCliAdapter;
    provider?: ProviderDefinition;
    commandPath: string;
    version: string | null;
  } | null> {
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
      return {
        adapter: createBuiltInAdapter(spec, commandPath),
        provider,
        commandPath,
        version: resolution.selected.version ?? null,
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

  async getAvailableProviders(): Promise<ProviderAvailability[]> {
    const results: ProviderAvailability[] = [];
    for (const p of this.providers.values()) {
      let cliAvailable = false;
      let cliVersion: string | null = null;
      let commandPath: string | null = null;
      let commandState: ProviderAvailability["cli"]["commandState"] = null;
      if (p.cli) {
        try {
          const spec = { id: p.name, agentFieldValue: p.agentFieldValue, plugin: p.cli.plugin };
          const resolution = await resolveBuiltInCommandResolution(spec, process.cwd());
          cliAvailable = resolution.selected?.state === "runnable"
            || resolution.selected?.state === "connected";
          cliVersion = resolution.selected?.version ?? null;
          commandPath = resolution.selected?.path ?? null;
          commandState = resolution.selected?.state ?? resolution.state;
        } catch {
          cliAvailable = false;
          commandState = "not-found";
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
              : connection?.testStatus === "connected" ? "connected"
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
          commandState: connection?.testStatus === "connected"
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
