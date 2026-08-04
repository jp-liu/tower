import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertReleaseContext } = require("../../../scripts/release-context.js");

const commit = "a".repeat(40);

describe("release context gate", () => {
  it("accepts one exact package/tag/commit identity", () => {
    expect(assertReleaseContext({
      packageName: "@tower-org/cli",
      version: "0.3.1",
      confirmation: "@tower-org/cli@0.3.1",
      tag: "v0.3.1",
      head: commit,
      tagCommit: commit,
      workflowSha: commit,
    })).toEqual({ tag: "v0.3.1", commit, packageSpec: "@tower-org/cli@0.3.1" });
  });

  it.each([
    ["tag", { tag: "v0.3.0" }],
    ["confirmation", { confirmation: "@tower-org/cli@0.3.0" }],
    ["tag commit", { tagCommit: "b".repeat(40) }],
    ["workflow commit", { workflowSha: "c".repeat(40) }],
  ])("rejects a mismatched %s", (_label, override) => {
    expect(() => assertReleaseContext({
      packageName: "@tower-org/cli",
      version: "0.3.1",
      confirmation: "@tower-org/cli@0.3.1",
      tag: "v0.3.1",
      head: commit,
      tagCommit: commit,
      workflowSha: commit,
      ...override,
    })).toThrow(/Release context gate failed/);
  });
});
