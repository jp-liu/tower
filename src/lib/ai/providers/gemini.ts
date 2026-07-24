import { towerCliPlugin } from "@tower/ai-provider-gemini";
import type { ProviderDefinition } from "../types";
import { createBuiltInAdapter } from "../provider-host";

export function createGeminiProvider(): ProviderDefinition {
  const builtIn = { id: "gemini", agentFieldValue: "GEMINI_CLI", plugin: towerCliPlugin };
  return {
    name: "gemini",
    displayName: "Gemini CLI",
    agentFieldValue: "GEMINI_CLI",
    cli: {
      command: "gemini",
      plugin: towerCliPlugin,
      adapter: createBuiltInAdapter(builtIn),
    },
    models: { cli: [], api: [] },
  };
}
