import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assemble, TARGETS } = require("../../../scripts/assemble-release-assets.js");
const { assertReleaseIdentity, sha256, verifyExistingAsset } = require("../../../scripts/publish-github-release.js");
const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("release asset assembly", () => {
  it("requires every tested target and emits deterministic checksums/notes", () => {
    const input = mkdtempSync(path.join(tmpdir(), "tower-assets-input-"));
    const output = mkdtempSync(path.join(tmpdir(), "tower-assets-output-"));
    roots.push(input, output);
    const commit = "a".repeat(40);
    for (const [platform, arch, extension] of TARGETS) {
      const name = `tower-portable-${platform}-${arch}.${extension}`;
      writeFileSync(path.join(input, name), `${platform}-${arch}`);
      writeFileSync(path.join(input, `${name}.manifest.json`), JSON.stringify({
        version: "0.3.1", platform, arch, sourceCommit: commit,
      }));
    }
    mkdirSync(path.join(input, "npm"));
    writeFileSync(path.join(input, "npm", "tower-org-cli-0.3.1.tgz"), "npm-pack");

    const result = assemble(input, output, commit);
    expect(result.copied).toHaveLength(8);
    expect(readFileSync(path.join(output, "SHA256SUMS"), "utf8").trim().split("\n")).toHaveLength(8);
    expect(readFileSync(path.join(output, "RELEASE_NOTES.md"), "utf8"))
      .toContain("Node.js >=22.0.0");
  });

  it("does not assemble a release with a missing target", () => {
    const input = mkdtempSync(path.join(tmpdir(), "tower-assets-missing-"));
    const output = mkdtempSync(path.join(tmpdir(), "tower-assets-output-"));
    roots.push(input, output);
    expect(() => assemble(input, output, "a".repeat(40))).toThrow(/expected one tested/);
  });

  it("reuses only checksum-identical assets and exact release notes", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tower-assets-idempotent-"));
    roots.push(root);
    const asset = path.join(root, "tower-portable-linux-x64.tar.gz");
    writeFileSync(asset, "immutable portable payload");
    const digest = sha256(asset);
    expect(verifyExistingAsset({ name: path.basename(asset), digest: `sha256:${digest}` }, asset)).toBe(digest);
    expect(() => verifyExistingAsset({ name: path.basename(asset), digest: `sha256:${"0".repeat(64)}` }, asset)).toThrow(/refusing to overwrite/);
    expect(() => assertReleaseIdentity({ tag_name: "v0.3.1", body: "expected\n" }, "v0.3.1", "different\n")).toThrow(/notes conflict/);
  });
});
