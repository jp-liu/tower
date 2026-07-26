import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  assertReleasePackage,
  REQUIRED_EMBEDDED_RUNTIME_DEPENDENCIES,
  REQUIRED_FILES,
} = require("../../../scripts/release-package-canary.js");

const manifest = {
  name: "@tower-org/cli",
  version: "0.3.0",
  publishConfig: {
    access: "public",
    registry: "https://registry.npmjs.org/",
    provenance: true,
  },
  dependencies: Object.fromEntries(REQUIRED_EMBEDDED_RUNTIME_DEPENDENCIES.map((name: string) => [name, "1.0.0"])),
};
const runtimeManifest = {
  dependencies: Object.fromEntries(REQUIRED_EMBEDDED_RUNTIME_DEPENDENCIES.map((name: string) => [name, "1.0.0"])),
};

function pack(extra: string[] = []) {
  return {
    name: "@tower-org/cli",
    version: "0.3.0",
    size: 1,
    unpackedSize: 2,
    files: [...REQUIRED_FILES, "skills/tower/SKILL.md", "extensions/tower-agent/manifest.json", ...extra]
      .map((path) => ({ path })),
  };
}

describe("release package canary", () => {
  it("accepts the complete release surface", () => {
    expect(assertReleasePackage(pack([
      ".next/standalone/.next/server/app/api/adapters/test/route.js",
    ]), manifest, runtimeManifest)).toMatchObject({ unpackedSize: 2 });
  });

  it("rejects missing runtime files", () => {
    const incomplete = pack();
    incomplete.files = incomplete.files.filter((entry: { path: string }) => entry.path !== "packages/ai-sdk/dist/index.js");
    expect(() => assertReleasePackage(incomplete, manifest, runtimeManifest)).toThrow(/missing required file/);
  });

  it.each([
    ".npmrc",
    "auth-token.txt",
    "database/tower.db",
    "extensions/cli-providers/qwen-code/test/provider.test.ts",
    "extensions/cli-providers/qwen-code/src/provider.spec.ts",
    "extensions/cli-providers/qwen-code/vitest.config.ts",
  ])("rejects private or test artifact %s", (artifact) => {
    expect(() => assertReleasePackage(pack([artifact]), manifest, runtimeManifest)).toThrow(/forbidden files/);
  });

  it("rejects workspace protocols in production dependencies", () => {
    expect(() => assertReleasePackage(pack(), {
      ...manifest,
      dependencies: { "@tower-org/ai-runtime": "workspace:*" },
    }, runtimeManifest)).toThrow(/workspace protocols/);
  });

  it("rejects a missing upstream AI SDK dependency", () => {
    expect(() => assertReleasePackage(pack(), manifest, { dependencies: {} }))
      .toThrow(/AI runtime dependency missing/);
  });

  it("rejects a missing CLI dependency required by the embedded runtime", () => {
    expect(() => assertReleasePackage(pack(), { ...manifest, dependencies: {} }, runtimeManifest))
      .toThrow(/CLI dependency missing for embedded AI runtime/);
  });
});
