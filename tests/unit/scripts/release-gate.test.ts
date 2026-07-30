import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  assertReleaseConfiguration,
  EXPECTED_PACKAGES,
  EXPECTED_REGISTRY,
} = require("../../../scripts/release-gate.js");

describe("release configuration gate", () => {
  it("accepts the fixed organization migration matrix", () => {
    expect(assertReleaseConfiguration()).toEqual({
      packageName: "@tower-org/cli",
      version: "0.3.1",
      registry: EXPECTED_REGISTRY,
    });
    expect([...EXPECTED_PACKAGES.values()]).toContainEqual({
      name: "tower-extension-qwen-code",
      version: "0.1.0",
      private: true,
    });
  });

  it("rejects a non-public registry", () => {
    expect(() => assertReleaseConfiguration({ registry: "https://registry.example.test/" }))
      .toThrow(/release registry must be/);
  });
});
