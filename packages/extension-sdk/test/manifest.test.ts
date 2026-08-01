import { describe, expect, it } from "vitest";
import {
  isExtensionManifestV2,
  parseExtensionManifestJson,
  parseExtensionManifestV2,
} from "../src/index.js";

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

  it.each([
    ["invalid SemVer", { ...component, version: "1.0.0-alpha..1" }],
    ["invalid Tower range", { ...component, engines: { ...component.engines, tower: "not-a-range" } }],
    ["empty SDK range", { ...component, engines: { ...component.engines, extensionSdk: "" } }],
    ["dot path", { ...component, entrypoints: { ...component.entrypoints, assets: "." } }],
    ["control character path", { ...component, entrypoints: { ...component.entrypoints, assets: "dist/\u0000asset" } }],
    ["URL path", { ...component, entrypoints: { ...component.entrypoints, assets: "https://evil.example/a" } }],
    ["unsafe mount", {
      ...component,
      entrypoints: {
        ...component.entrypoints,
        activation: { ...component.entrypoints.activation, mount: "../../public" },
      },
    }],
    ["duplicate capability", { ...component, capabilities: ["code-editor", "code-editor"] }],
  ])("rejects %s", (_label, value) => {
    expect(isExtensionManifestV2(value)).toBe(false);
  });

  it("rejects duplicate keys in raw JSON, including escaped equivalents", () => {
    const source = JSON.stringify(component).replace(
      '"id":"tower.monaco"',
      '"id":"tower.monaco","\\u0069d":"other.id"',
    );
    expect(() => parseExtensionManifestJson(source)).toThrow(
      "Invalid Tower extension manifest v2",
    );
  });

  it("parses a valid raw manifest", () => {
    expect(parseExtensionManifestJson(JSON.stringify(component))).toEqual(component);
  });

  it("rejects raw manifests larger than 1 MiB before parsing", () => {
    const oversized = `${JSON.stringify(component)}${" ".repeat(1024 * 1024)}`;
    expect(() => parseExtensionManifestJson(oversized)).toThrow(
      "Invalid Tower extension manifest v2",
    );
  });
});
