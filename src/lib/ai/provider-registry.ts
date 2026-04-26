import type { CliAdapter, AiQueryAdapter, ProviderDefinition, ProviderAvailability } from "./types";

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

  getCliAdapter(name: string): CliAdapter | null {
    return this.providers.get(name)?.cli?.adapter ?? null;
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
      const cliAvailable = p.cli ? await p.cli.adapter.isAvailable() : false;
      const cliVersion = cliAvailable && p.cli ? await p.cli.adapter.getVersion() : null;
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
