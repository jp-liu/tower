import type { ProviderDefinition } from "../types";
import { CodexCliAdapter } from "../adapters/cli/codex-cli-adapter";

export function createCodexProvider(): ProviderDefinition {
  return {
    name: "codex",
    displayName: "Codex CLI",
    agentFieldValue: "CODEX_CLI",
    cli: {
      command: "codex",
      adapter: new CodexCliAdapter(),
    },
    // api adapter uses OpenAI SDK — will be added in Phase 2
    models: {
      cli: ["o4-mini", "o3", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "codex-mini-latest"],
      api: [],
    },
  };
}
