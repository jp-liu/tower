globalThis.__towerFixtureLoads = (globalThis.__towerFixtureLoads ?? 0) + 1;

const manifest = {
  manifestVersion: 1,
  apiVersion: "1.0",
  kind: "cli-provider",
  display: { name: "Fixture CLI" },
  command: { default: "fixture-cli" },
  compatibility: { tower: ">=0.3.0 <1.0.0", node: ">=20" },
  capabilities: {
    sessions: { fresh: true },
    query: { generate: true },
    models: true,
  },
  permissions: ["process:spawn"],
  configSchema: "./config.schema.json",
};

export const towerCliPlugin = {
  manifest,
  createAdapter() {
    return {
      buildSessionProcess(options) {
        return { command: "fixture-cli", args: [options.prompt] };
      },
      buildHelloProbe(options) {
        return { command: options.command, args: [options.prompt], cwd: options.cwd };
      },
      async generate() {
        return { text: "fixture-ok" };
      },
      async models() {
        return [{ id: "fixture" }];
      },
    };
  },
};
