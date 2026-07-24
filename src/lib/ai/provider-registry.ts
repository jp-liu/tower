import type { CliAdapter as SdkCliAdapter } from "@tower/ai-sdk";
import type { AiQueryAdapter, ProviderDefinition, ProviderAvailability } from "./types";
import {
  createBuiltInAdapter,
  resolveBuiltInCommand,
  resolveBuiltInCommandResolution,
} from "./provider-host";

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

  async createResolvedCliAdapter(name: string, cwd: string, commandOverride?: string) {
    const provider = this.providers.get(name);
    if (!provider?.cli) return null;
    const spec = { id: provider.name, agentFieldValue: provider.agentFieldValue, plugin: provider.cli.plugin };
    const commandPath = await resolveBuiltInCommand(spec, cwd, commandOverride);
    return { adapter: createBuiltInAdapter(spec, commandPath), commandPath };
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
      if (p.cli) {
        try {
          const spec = { id: p.name, agentFieldValue: p.agentFieldValue, plugin: p.cli.plugin };
          const resolution = await resolveBuiltInCommandResolution(spec, process.cwd());
          cliAvailable = resolution.selected?.state === "runnable"
            || resolution.selected?.state === "connected";
          cliVersion = resolution.selected?.version ?? null;
        } catch {
          cliAvailable = false;
        }
      }
      const apiKeyConfigured = p.api ? !!process.env[p.api.keyEnvVar] : false;
      const apiAvailable = p.api ? apiKeyConfigured : false;

      results.push({
        name: p.name,
        displayName: p.displayName,
        cli: { available: cliAvailable, version: cliVersion },
        api: { available: apiAvailable, keyConfigured: apiKeyConfigured },
      });
    }
    return results;
  }
}
