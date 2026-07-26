globalThis.__towerFixtureLoads = (globalThis.__towerFixtureLoads ?? 0) + 1;

const manifest = {
  manifestVersion: 1,
  apiVersion: "1.0",
  id: "fixture.tower-cli",
  kind: "cli-provider",
  publisher: { id: "fixture-labs", name: "Fixture Labs" },
  display: { name: "Fixture CLI" },
  entry: "./provider.js",
  command: { default: "fixture-cli", versionArgs: ["--version"] },
  cliDependency: {
    name: "Fixture CLI",
    homepage: "https://example.com/fixture-cli",
    installDocs: "https://example.com/fixture-cli/install",
    supportedVersions: ">=1.0.0 <2.0.0",
    managedByTower: false,
  },
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
