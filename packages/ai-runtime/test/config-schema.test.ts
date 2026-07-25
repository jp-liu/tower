import { describe, expect, it } from "vitest";
import type { CliConfigSchema } from "@tower/ai-sdk";
import {
  validatePluginConfigSchema,
  validatePluginSettings,
} from "../src/index.js";

const schema: CliConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    profile: { type: "string", default: "default", "x-tower": { control: "text", sensitive: true } },
    retries: { type: "integer", minimum: 0, default: 2, "x-tower": { control: "number" } },
    active: { type: "boolean", default: true, "x-tower": { control: "switch" } },
    mode: { type: "string", enum: ["fast", "safe"], "x-tower": { control: "select" } },
    features: {
      type: "array",
      items: { type: "string", enum: ["mcp", "hooks"] },
      "x-tower": { control: "multiselect" },
    },
    executable: { type: "string", "x-tower": { control: "path" } },
    tags: { type: "array", items: { type: "string" }, "x-tower": { control: "string-list" } },
    variables: {
      type: "object",
      additionalProperties: { type: "string" },
      "x-tower": { control: "key-value" },
    },
  },
  required: ["mode"],
  additionalProperties: false,
};

describe("safe CLI plugin configuration schemas", () => {
  it("validates all v1 controls and applies defaults only to missing fields", () => {
    validatePluginConfigSchema(schema);
    expect(validatePluginSettings(schema, {
      mode: "safe",
      profile: "",
      features: ["mcp"],
      executable: "/opt/bin/cli",
      tags: ["one"],
      variables: { TOKEN: "canary" },
    }, { applyDefaults: true })).toEqual({
      mode: "safe",
      profile: "",
      retries: 2,
      active: true,
      features: ["mcp"],
      executable: "/opt/bin/cli",
      tags: ["one"],
      variables: { TOKEN: "canary" },
    });
  });

  it("enforces required and enum values", () => {
    expect(() => validatePluginSettings(schema, {})).toThrowError(expect.objectContaining({
      code: "INVALID_CONFIG_SCHEMA",
    }));
    expect(() => validatePluginSettings(schema, { mode: "unsafe" })).toThrowError(expect.objectContaining({
      code: "INVALID_CONFIG_SCHEMA",
    }));
  });

  it.each([
    { ...schema, $ref: "https://attacker.invalid/schema.json" },
    { ...schema, properties: { injected: { type: "string", "x-tower": { control: "text" }, script: "alert(1)" } } },
    { ...schema, properties: { injected: { type: "string", "x-tower": { control: "html" } } } },
    { ...schema, anyOf: [{ type: "object" }] },
  ])("rejects remote references, scripts, injected controls, and composition", (unsafe) => {
    expect(() => validatePluginConfigSchema(unsafe)).toThrowError(expect.objectContaining({
      code: "INVALID_CONFIG_SCHEMA",
    }));
  });
});
