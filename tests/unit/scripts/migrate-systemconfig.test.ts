// @vitest-environment node
import { describe, it, expect } from "vitest";
import { selectMissingConfig } from "../../../scripts/migrations/0003-backfill-systemconfig-from-legacy-db";

describe("selectMissingConfig (legacy SystemConfig backfill merge)", () => {
  it("returns only legacy keys absent from the current DB", () => {
    const legacy = [
      { key: "git.pathMappingRules", value: "[]" },
      { key: "terminal.app", value: '"iTerm"' },
      { key: "editor.command", value: '"code"' },
    ];
    const current = new Set(["terminal.app"]);

    const missing = selectMissingConfig(legacy, current);

    expect(missing.map((r) => r.key)).toEqual([
      "git.pathMappingRules",
      "editor.command",
    ]);
  });

  it("never overwrites an existing key (additive only)", () => {
    const legacy = [{ key: "git.pathMappingRules", value: "LEGACY" }];
    const current = new Set(["git.pathMappingRules"]);

    expect(selectMissingConfig(legacy, current)).toEqual([]);
  });

  it("returns nothing when the legacy DB has no rows", () => {
    expect(selectMissingConfig([], new Set(["anything"]))).toEqual([]);
  });

  it("returns all legacy rows when the current DB is empty", () => {
    const legacy = [
      { key: "a", value: "1" },
      { key: "b", value: "2" },
    ];
    expect(selectMissingConfig(legacy, new Set())).toEqual(legacy);
  });
});
