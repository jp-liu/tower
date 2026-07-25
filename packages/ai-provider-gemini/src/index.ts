import { defineCliPlugin, type CliPluginManifestV1 } from "@tower/ai-sdk";
import { GeminiCliAdapter } from "./adapter.js";

export const geminiManifest = {
  manifestVersion: 1,
  apiVersion: "1.0",
  kind: "cli-provider",
  display: {
    name: "Gemini CLI",
    description: "Official Tower provider for the Google Gemini CLI",
  },
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
