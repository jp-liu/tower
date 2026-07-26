import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  assertReleasePackage,
  REQUIRED_AI_RUNTIME_DEPENDENCIES,
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
  dependencies: { prisma: "^6.19.2" },
};
const runtimeManifest = {
  dependencies: Object.fromEntries(REQUIRED_AI_RUNTIME_DEPENDENCIES.map((name: string) => [name, "1.0.0"])),
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
    expect(assertReleasePackage(pack(), manifest, runtimeManifest)).toMatchObject({ unpackedSize: 2 });
  });

  it("rejects missing runtime files and private data", () => {
    const incomplete = pack(["database/tower.db", "packages/ai-runtime/test/plugin-runtime.test.ts"]);
    incomplete.files = incomplete.files.filter((entry: { path: string }) => entry.path !== "packages/ai-sdk/dist/index.js");
    expect(() => assertReleasePackage(incomplete, manifest, runtimeManifest)).toThrow(/missing required file/);
    expect(() => assertReleasePackage(incomplete, manifest, runtimeManifest)).toThrow(/forbidden files/);
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
});
