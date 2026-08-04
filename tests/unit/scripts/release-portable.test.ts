import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assertPortableRoot } = require("../../../scripts/release-portable-canary.js");
const { normalizePrismaGeneratedPaths } = require("../../../scripts/build-portable-release.js");
const roots: string[] = [];

function file(root: string, relative: string, content = "fixture") {
  const target = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "tower-portable-test-"));
  roots.push(root);
  const packageRoot = "runtime/package";
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const manifest = {
    schema: 1,
    package: "@tower-org/cli",
    version: "0.3.1",
    platform,
    arch: process.arch,
    node: { minimum: "22.0.0", tested: ["22", "24"], knownIncompatible: [] },
    sourceCommit: "a".repeat(40),
    packageRoot,
    towerEntry: "bin/tower",
    mcpEntry: `${packageRoot}/dist/mcp-server.cjs`,
  };
  file(root, "portable-manifest.json", JSON.stringify(manifest));
  file(root, "LICENSE");
  file(root, "bin/tower");
  file(root, `${packageRoot}/package.json`, JSON.stringify({ name: "@tower-org/cli", version: "0.3.1" }));
  file(root, `${packageRoot}/dist/mcp-server.cjs`);
  file(root, `${packageRoot}/.next/standalone/server.js`);
  file(root, `${packageRoot}/prisma/schema.prisma`);
  file(root, `${packageRoot}/node_modules/@prisma/client/LICENSE`);
  file(root, `${packageRoot}/node_modules/node-pty/LICENSE`);
  file(root, `${packageRoot}/node_modules/@vscode/ripgrep/LICENSE`);
  file(root, "runtime/package/node_modules/.prisma/client/libquery_engine-test.node");
  file(root, "runtime/package/node_modules/@prisma/engines/schema-engine-test");
  file(root, "runtime/package/node_modules/node-pty/prebuilds/test/pty.node");
  file(root, "runtime/package/node_modules/@vscode/ripgrep-test/bin/rg");
  file(root, "runtime/package/node_modules/@vscode/ripgrep-deadbeef/package.json");
  return { root, manifest };
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("portable release canary", () => {
  it("accepts a complete native payload for the current runner", () => {
    const { root, manifest } = fixture();
    expect(assertPortableRoot(root)).toMatchObject({ manifest, files: expect.any(Number) });
  });

  it("rejects a payload without the Prisma Schema Engine", () => {
    const { root } = fixture();
    rmSync(path.join(root, "runtime/package/node_modules/@prisma/engines/schema-engine-test"));
    expect(() => assertPortableRoot(root)).toThrow(/Prisma Schema Engine/);
  });

  it("rejects an untested or drifting Node contract", () => {
    const { root, manifest } = fixture();
    manifest.node = { minimum: "22.0.0", tested: ["22"], knownIncompatible: [] };
    writeFileSync(path.join(root, "portable-manifest.json"), JSON.stringify(manifest));
    expect(() => assertPortableRoot(root)).toThrow(/Node contract/);
  });

  it("accepts dependency links that resolve inside the archive", () => {
    const { root } = fixture();
    const target = path.join(root, "runtime/package/node_modules/node-pty");
    const link = path.join(root, "runtime/package/node_modules/node-pty-copy");
    symlinkSync(path.relative(path.dirname(link), target), link, "junction");
    expect(() => assertPortableRoot(root)).not.toThrow();
  });

  it("removes temporary build roots from generated Prisma metadata", () => {
    const { root, manifest } = fixture();
    const packageRoot = path.join(root, ...manifest.packageRoot.split("/"));
    const generated = path.join(packageRoot, "node_modules/.prisma/client/index.js");
    file(root, `${manifest.packageRoot}/node_modules/.prisma/client/index.js`, JSON.stringify({ sourceFilePath: `${packageRoot}/prisma/schema.prisma` }));
    normalizePrismaGeneratedPaths(packageRoot);
    expect(readFileSync(generated, "utf8")).toContain("/tower-portable/runtime/package/prisma/schema.prisma");
    expect(readFileSync(generated, "utf8")).not.toContain(packageRoot);
  });
});
