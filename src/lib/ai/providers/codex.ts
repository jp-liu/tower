import type { ProviderDefinition } from "../types";
import { towerCliPlugin } from "@tower/ai-provider-codex";
import { createBuiltInAdapter } from "../provider-host";

export function createCodexProvider(): ProviderDefinition {
  const builtIn = { id: "codex", agentFieldValue: "CODEX_CLI", plugin: towerCliPlugin };
  return {
    name: "codex",
    displayName: "Codex CLI",
    agentFieldValue: "CODEX_CLI",
    builtin: true,
    cli: {
      command: "codex",
      plugin: towerCliPlugin,
      adapter: createBuiltInAdapter(builtIn),
    },
    // api adapter uses OpenAI SDK — will be added in Phase 2
    // CLI models stay empty on purpose so the user's Codex account default wins.
    models: {
      cli: [],
      api: [],
    },
  };
}
