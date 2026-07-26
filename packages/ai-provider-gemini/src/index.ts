import { defineCliPlugin, type CliPluginManifestV1 } from "@tower-org/ai-sdk";
import { GeminiCliAdapter } from "./adapter.js";

export const providerVersion = "0.1.0";

export const geminiManifest = {
  manifestVersion: 1,
  apiVersion: "1.0",
  id: "tower.gemini-cli",
  kind: "cli-provider",
  publisher: { id: "tower", name: "Tower" },
  display: {
    name: "Gemini CLI",
    description: "Official Tower provider for the Google Gemini CLI",
  },
  entry: "./dist/index.js",
  command: {
    default: "gemini",
    aliases: ["gemini-cli"],
    knownPaths: {
      darwin: ["~/.npm-global/bin/gemini", "/usr/local/bin/gemini"],
      linux: ["~/.npm-global/bin/gemini", "/usr/local/bin/gemini"],
      win32: ["%APPDATA%\\npm\\gemini.cmd"],
    },
    versionArgs: ["--version"],
  },
  cliDependency: {
    name: "Gemini CLI",
    homepage: "https://github.com/google-gemini/gemini-cli",
    installDocs: "https://github.com/google-gemini/gemini-cli#installation",
    supportedVersions: ">=0.1.0",
    managedByTower: false,
  },
  compatibility: { tower: ">=0.3.0 <0.4.0", node: ">=18" },
  capabilities: {
    sessions: { fresh: true, resume: true, continue: true },
    query: { generate: true, stream: true },
    models: true,
    integrations: { mcp: true, hooks: false, skills: true },
  },
  permissions: [
    "process:spawn",
    "network:provider",
    "integration:mcp",
    "integration:skills",
  ],
  configSchema: "./config.schema.json",
} satisfies CliPluginManifestV1;

export const towerCliPlugin = defineCliPlugin({
  manifest: geminiManifest,
  createAdapter: (host) => new GeminiCliAdapter(host),
});

export { GeminiCliAdapter } from "./adapter.js";
