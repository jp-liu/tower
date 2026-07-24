import type { ProviderDefinition } from "../types";
import { towerCliPlugin } from "@tower/ai-provider-codex";
import { createBuiltInAdapter } from "../provider-host";

export function createCodexProvider(): ProviderDefinition {
  const builtIn = { id: "codex", agentFieldValue: "CODEX_CLI", plugin: towerCliPlugin };
  return {
    name: "codex",
    displayName: "Codex CLI",
    agentFieldValue: "CODEX_CLI",
    cli: {
      command: "codex",
      plugin: towerCliPlugin,
      adapter: createBuiltInAdapter(builtIn),
    },
    // api adapter uses OpenAI SDK — will be added in Phase 2
    // cli models empty on purpose — let ~/.codex account default win; see
    // CODEX_MODELS note in codex-cli-adapter.ts.
    models: {
      cli: [],
      api: [],
    },
  };
}
