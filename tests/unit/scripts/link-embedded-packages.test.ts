import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { EMBEDDED_PACKAGES, linkEmbeddedPackages } = require("../../../scripts/link-embedded-packages.js");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("link embedded packages", () => {
  it("links every private workspace package into the installed Node resolution tree", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tower-embedded-packages-"));
    temporaryRoots.push(root);
    for (const relativeTarget of Object.values(EMBEDDED_PACKAGES) as string[]) {
      fs.mkdirSync(path.join(root, relativeTarget), { recursive: true });
    }

    linkEmbeddedPackages(root);

    for (const [packageName, relativeTarget] of Object.entries(EMBEDDED_PACKAGES) as [string, string][]) {
      const link = path.join(root, "node_modules", ...packageName.split("/"));
      expect(fs.realpathSync(link)).toBe(fs.realpathSync(path.join(root, relativeTarget)));
    }
  });

  it("does not replace an existing package path with a different target", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tower-embedded-packages-"));
    temporaryRoots.push(root);
    for (const relativeTarget of Object.values(EMBEDDED_PACKAGES) as string[]) {
      fs.mkdirSync(path.join(root, relativeTarget), { recursive: true });
    }
    const conflicting = path.join(root, "node_modules", "@tower-org", "ai-sdk");
    fs.mkdirSync(conflicting, { recursive: true });

    expect(() => linkEmbeddedPackages(root)).toThrow(/Refusing to replace existing package path/);
  });
});
