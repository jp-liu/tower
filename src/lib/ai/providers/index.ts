import { ProviderRegistry } from "../provider-registry";
import { createClaudeProvider } from "./claude";

// Singleton registry — survives HMR via globalThis
const g = globalThis as typeof globalThis & { __providerRegistry?: ProviderRegistry };
if (!g.__providerRegistry) {
  const registry = new ProviderRegistry();
  registry.register(createClaudeProvider());
  g.__providerRegistry = registry;
}

export const providerRegistry = g.__providerRegistry;
