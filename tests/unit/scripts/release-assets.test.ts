import { createRequire } from "node:module";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assemble, TARGETS } = require("../../../scripts/assemble-release-assets.js");
const {
  assertReleaseIdentity,
  createRelease,
  getRelease,
  publish,
  publishRelease,
  resolveTagCommit,
  sha256,
  verifyExistingAsset,
} = require("../../../scripts/publish-github-release.js");
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
        version: "0.4.0", platform, arch, sourceCommit: commit,
      }));
    }
    mkdirSync(path.join(input, "npm"));
    writeFileSync(path.join(input, "npm", "tower-org-cli-0.4.0.tgz"), "npm-pack");

    const result = assemble(input, output, commit);
    expect(result.copied).toHaveLength(8);
    expect(readFileSync(path.join(output, "SHA256SUMS"), "utf8").trim().split("\n")).toHaveLength(8);
    expect(existsSync(path.join(output, "CHANGELOG.md"))).toBe(false);
    expect(existsSync(path.join(output, "install.cmd"))).toBe(false);
    expect(readFileSync(path.join(output, "RELEASE_NOTES.md"), "utf8"))
      .toContain("Node.js >=22.0.0");
    expect(readFileSync(path.join(output, "RELEASE_NOTES.md"), "utf8"))
      .toContain("--rollback");
  });

  it("assembles an explicitly unpublished Candidate with metadata and platform manifests", () => {
    const input = mkdtempSync(path.join(tmpdir(), "tower-candidate-input-"));
    const output = mkdtempSync(path.join(tmpdir(), "tower-candidate-output-"));
    roots.push(input, output);
    const commit = "c".repeat(40);
    for (const [platform, arch, extension] of TARGETS) {
      const name = `tower-portable-${platform}-${arch}.${extension}`;
      writeFileSync(path.join(input, name), `${platform}-${arch}`);
      writeFileSync(path.join(input, `${name}.manifest.json`), JSON.stringify({
        version: "0.4.0", platform, arch, sourceCommit: commit,
      }));
    }
    writeFileSync(path.join(input, "tower-org-cli-0.4.0.tgz"), "npm-pack");

    const result = assemble(input, output, commit, { candidate: {
      ref: "refs/heads/candidate-preview",
      dispatchRef: "refs/heads/main",
      runId: "123456789",
      runAttempt: "2",
      generatedAt: "2026-08-05T04:03:02Z",
    } });

    const metadata = JSON.parse(readFileSync(path.join(output, "CANDIDATE_METADATA.json"), "utf8"));
    expect(metadata).toEqual({
      schema: 1,
      kind: "release-candidate",
      published: false,
      commit,
      ref: "refs/heads/candidate-preview",
      dispatchRef: "refs/heads/main",
      packageName: "@tower-org/cli",
      packageVersion: "0.4.0",
      workflow: { runId: "123456789", runAttempt: "2" },
      generatedAt: "2026-08-05T04:03:02Z",
    });
    expect(result.copied).toHaveLength(14);
    expect(readFileSync(path.join(output, "SHA256SUMS"), "utf8").trim().split("\n")).toHaveLength(14);
    for (const [platform, arch, extension] of TARGETS) {
      expect(readFileSync(path.join(output, `tower-portable-${platform}-${arch}.${extension}.manifest.json`), "utf8"))
        .toContain(commit);
    }
    const notes = readFileSync(path.join(output, "CANDIDATE_RELEASE_NOTES.md"), "utf8");
    expect(notes).toContain("NOT A RELEASE");
    expect(notes).toContain("build identity only");
    expect(notes).toContain("--asset-dir . --verify");
    expect(notes).not.toContain("install.cmd");
    expect(notes).not.toContain("releases/download");
    expect(notes).toContain("@tower-org/cli@0.4.0");
  });

  it("rejects incomplete or non-UTC Candidate identity", () => {
    const input = mkdtempSync(path.join(tmpdir(), "tower-candidate-invalid-input-"));
    const output = mkdtempSync(path.join(tmpdir(), "tower-candidate-invalid-output-"));
    roots.push(input, output);
    expect(() => assemble(input, output, "d".repeat(40), { candidate: {
      ref: "refs/heads/main",
      dispatchRef: "refs/heads/main",
      runId: "1",
      runAttempt: "1",
      generatedAt: "2026-08-05T12:00:00+08:00",
    } })).toThrow(/UTC timestamp/);
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

  it("creates a draft and only publishes it with a final patch", () => {
    let created: Record<string, unknown> | undefined;
    let patched: Record<string, unknown> | undefined;
    const draft = createRelease("tower-org/tower", "v0.4.0", "a".repeat(40), "notes", (args: string[]) => {
      created = JSON.parse(readFileSync(args.at(-1)!, "utf8"));
      return { id: 42, ...created };
    });
    expect(created).toMatchObject({ tag_name: "v0.4.0", target_commitish: "a".repeat(40), draft: true });
    publishRelease("tower-org/tower", draft, (args: string[]) => {
      patched = JSON.parse(readFileSync(args.at(-1)!, "utf8"));
      return { ...draft, draft: false };
    });
    expect(patched).toEqual({ draft: false });
  });

  it("finds an unpublished draft when the public tag endpoint returns 404", () => {
    const error = Object.assign(new Error("missing"), { status: 1, stderr: "HTTP 404: Not Found" });
    const draft = { id: 42, tag_name: "v0.4.0", draft: true };
    expect(getRelease("tower-org/tower", "v0.4.0", (args: string[]) => {
      if (args[1].includes("/releases/tags/")) throw error;
      return [[draft]];
    })).toEqual(draft);
  });

  it("creates a draft, uploads every immutable asset, then publishes it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tower-assets-publish-"));
    roots.push(root);
    const notesPath = path.join(root, "RELEASE_NOTES.md");
    writeFileSync(notesPath, "release notes\n");
    writeFileSync(path.join(root, "SHA256SUMS"), "checksums\n");
    const uploaded: string[] = [];
    const published: number[] = [];
    const release = { id: 42, tag_name: "v0.4.0", body: "release notes\n", assets: [], draft: true };
    publish({ repository: "tower-org/tower", tag: "v0.4.0", commit: "a".repeat(40), assetsDir: root, notesPath }, {
      resolveTagCommit: () => "a".repeat(40),
      getRelease: () => null,
      createRelease: () => release,
      uploadAsset: (_repository: string, _tag: string, file: string) => uploaded.push(path.basename(file)),
      publishRelease: (_repository: string, draft: { id: number }) => {
        published.push(draft.id);
        return { ...release, draft: false };
      },
    });
    expect(uploaded).toEqual(["SHA256SUMS"]);
    expect(published).toEqual([42]);
  });

  it("repairs a partial release but refuses a moved tag before any upload", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tower-assets-repair-"));
    roots.push(root);
    const notesPath = path.join(root, "RELEASE_NOTES.md");
    const assetPath = path.join(root, "SHA256SUMS");
    writeFileSync(notesPath, "release notes\n");
    writeFileSync(assetPath, "checksums\n");
    const uploaded: string[] = [];
    const published: number[] = [];
    publish({ repository: "tower-org/tower", tag: "v0.4.0", commit: "a".repeat(40), assetsDir: root, notesPath }, {
      resolveTagCommit: () => "a".repeat(40),
      getRelease: () => ({ id: 43, tag_name: "v0.4.0", body: "release notes", draft: true, assets: [{ name: "SHA256SUMS" }] }),
      verifyExistingAsset: () => sha256(assetPath),
      uploadAsset: (_repository: string, _tag: string, file: string) => uploaded.push(file),
      publishRelease: (_repository: string, draft: { id: number }) => {
        published.push(draft.id);
        return { ...draft, draft: false };
      },
    });
    expect(uploaded).toEqual([]);
    expect(published).toEqual([43]);

    expect(() => publish({ repository: "tower-org/tower", tag: "v0.3.1", commit: "a".repeat(40), assetsDir: root, notesPath }, {
      resolveTagCommit: () => "b".repeat(40),
      getRelease: () => { throw new Error("must not inspect a release for a moved tag"); },
    })).toThrow(/remote tag.*not release commit/);
  });

  it("does not mutate an immutable published release with missing assets", () => {
    const root = mkdtempSync(path.join(tmpdir(), "tower-assets-immutable-"));
    roots.push(root);
    const notesPath = path.join(root, "RELEASE_NOTES.md");
    writeFileSync(notesPath, "release notes\n");
    writeFileSync(path.join(root, "SHA256SUMS"), "checksums\n");
    expect(() => publish({ repository: "tower-org/tower", tag: "v0.4.0", commit: "a".repeat(40), assetsDir: root, notesPath }, {
      resolveTagCommit: () => "a".repeat(40),
      getRelease: () => ({ tag_name: "v0.4.0", body: "release notes", draft: false, immutable: true, assets: [] }),
      uploadAsset: () => { throw new Error("must not upload"); },
    })).toThrow(/create a new version/);
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
