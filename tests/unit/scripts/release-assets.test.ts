import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assemble, TARGETS } = require("../../../scripts/assemble-release-assets.js");
const { assertReleaseIdentity, publish, resolveTagCommit, sha256, verifyExistingAsset } = require("../../../scripts/publish-github-release.js");
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
    expect(readFileSync(path.join(output, "RELEASE_NOTES.md"), "utf8"))
      .toContain("--rollback");
  });

  it("peels an annotated remote tag to its commit", () => {
    const commit = "a".repeat(40);
    const tagObject = "b".repeat(40);
    expect(resolveTagCommit("tower-org/tower", "v0.3.1", (args: string[]) => {
      const endpoint = args[1];
      if (endpoint.endsWith("/git/ref/tags/v0.3.1")) return { object: { type: "tag", sha: tagObject } };
      if (endpoint.endsWith(`/git/tags/${tagObject}`)) return { object: { type: "commit", sha: commit } };
      throw new Error(`unexpected endpoint ${endpoint}`);
    })).toBe(commit);
  });

  it("creates a missing release and uploads every immutable asset", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tower-assets-publish-"));
    roots.push(root);
    const notesPath = path.join(root, "RELEASE_NOTES.md");
    writeFileSync(notesPath, "release notes\n");
    writeFileSync(path.join(root, "SHA256SUMS"), "checksums\n");
    const uploaded: string[] = [];
    const release = { tag_name: "v0.3.1", body: "release notes\n", assets: [] };
    publish({ repository: "tower-org/tower", tag: "v0.3.1", commit: "a".repeat(40), assetsDir: root, notesPath }, {
      resolveTagCommit: () => "a".repeat(40),
      getRelease: () => null,
      createRelease: () => release,
      uploadAsset: (_repository: string, _tag: string, file: string) => uploaded.push(path.basename(file)),
    });
    expect(uploaded).toEqual(["SHA256SUMS"]);
  });

  it("repairs a partial release but refuses a moved tag before any upload", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tower-assets-repair-"));
    roots.push(root);
    const notesPath = path.join(root, "RELEASE_NOTES.md");
    const assetPath = path.join(root, "SHA256SUMS");
    writeFileSync(notesPath, "release notes\n");
    writeFileSync(assetPath, "checksums\n");
    const uploaded: string[] = [];
    publish({ repository: "tower-org/tower", tag: "v0.3.1", commit: "a".repeat(40), assetsDir: root, notesPath }, {
      resolveTagCommit: () => "a".repeat(40),
      getRelease: () => ({ tag_name: "v0.3.1", body: "release notes", assets: [{ name: "SHA256SUMS" }] }),
      verifyExistingAsset: () => sha256(assetPath),
      uploadAsset: (_repository: string, _tag: string, file: string) => uploaded.push(file),
    });
    expect(uploaded).toEqual([]);

    expect(() => publish({ repository: "tower-org/tower", tag: "v0.3.1", commit: "a".repeat(40), assetsDir: root, notesPath }, {
      resolveTagCommit: () => "b".repeat(40),
      getRelease: () => { throw new Error("must not inspect a release for a moved tag"); },
    })).toThrow(/remote tag.*not release commit/);
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
