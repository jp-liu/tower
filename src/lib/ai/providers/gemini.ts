import { providerVersion, towerCliPlugin } from "@tower-org/ai-provider-gemini";
import type { ProviderDefinition } from "../types";
import { createBuiltInAdapter } from "../provider-host";

export function createGeminiProvider(): ProviderDefinition {
  const builtIn = { id: "gemini", agentFieldValue: "GEMINI_CLI", plugin: towerCliPlugin };
  return {
    name: "gemini",
    displayName: "Gemini CLI",
    version: providerVersion,
    agentFieldValue: "GEMINI_CLI",
    builtin: true,
    cli: {
      command: "gemini",
      plugin: towerCliPlugin,
      adapter: createBuiltInAdapter(builtIn),
    },
    models: { cli: [], api: [] },
  };
}
