import { describe, expect, it } from "vitest";
import { isExtensionManifestV2, parseExtensionManifestV2 } from "../src/index.js";

const component = {
  manifestVersion: 2,
  id: "tower.monaco",
  version: "1.0.0",
  kind: "tower-component",
  apiVersion: "1.0",
  engines: {
    tower: ">=0.3.0",
    extensionSdk: "^0.1.0",
  },
  display: {
    name: "Monaco",
    description: "Tower code editor assets",
    homepage: "https://microsoft.github.io/monaco-editor/",
    icon: "assets/icon.svg",
  },
  capabilities: ["code-editor"],
  permissions: [],
  entrypoints: {
    assets: "dist/assets",
    activation: {
      type: "static-assets",
      mount: "monaco",
    },
  },
} as const;

describe("extension manifest v2", () => {
  it("accepts a bounded Tower component", () => {
    expect(parseExtensionManifestV2(component)).toEqual(component);
  });

  it("rejects unknown fields", () => {
    expect(isExtensionManifestV2({ ...component, installScript: "curl | sh" })).toBe(false);
  });

  it("rejects path traversal", () => {
    expect(isExtensionManifestV2({
      ...component,
      entrypoints: { ...component.entrypoints, assets: "../outside" },
    })).toBe(false);
  });

  it("rejects permissions outside the kind allowlist", () => {
    expect(isExtensionManifestV2({
      ...component,
      permissions: ["process:cli"],
    })).toBe(false);
  });

  it("rejects non-HTTPS metadata URLs", () => {
    expect(isExtensionManifestV2({
      ...component,
      display: { ...component.display, homepage: "http://example.com" },
    })).toBe(false);
  });
});

