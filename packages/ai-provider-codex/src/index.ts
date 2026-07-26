import { defineCliPlugin, type CliPluginManifestV1 } from "@tower-org/ai-sdk";
import { CodexCliAdapter } from "./adapter.js";

export const providerVersion = "0.1.0";

export const codexManifest = {
  manifestVersion: 1,
  apiVersion: "1.0",
  id: "tower.codex-cli",
  kind: "cli-provider",
  publisher: { id: "tower", name: "Tower" },
  display: {
    name: "Codex CLI",
    description: "Official Tower provider for the OpenAI Codex CLI",
  },
  entry: "./dist/index.js",
  command: {
    default: "codex",
    aliases: ["codex-cli"],
    knownPaths: {
      darwin: ["/usr/local/bin/codex", "~/.npm-global/bin/codex"],
      linux: ["/usr/local/bin/codex", "~/.npm-global/bin/codex"],
      win32: ["%APPDATA%\\npm\\codex.cmd"],
    },
    versionArgs: ["--version"],
  },
  cliDependency: {
    name: "Codex CLI",
    homepage: "https://github.com/openai/codex",
    installDocs: "https://github.com/openai/codex#installation",
    supportedVersions: ">=0.1.0",
    managedByTower: false,
  },
  compatibility: { tower: ">=0.3.0 <0.4.0", node: ">=18" },
  capabilities: {
    sessions: { fresh: true, resume: true, continue: true },
    query: { generate: true, stream: true },
    models: true,
    integrations: { mcp: true, hooks: true, skills: true },
  },
  permissions: [
    "process:spawn",
    "filesystem:provider-config",
    "network:provider",
    "integration:mcp",
    "integration:hooks",
    "integration:skills",
  ],
  configSchema: "./config.schema.json",
} satisfies CliPluginManifestV1;

export const towerCliPlugin = defineCliPlugin({
  manifest: codexManifest,
  createAdapter: (host) => new CodexCliAdapter(host),
});

export { CodexCliAdapter } from "./adapter.js";
