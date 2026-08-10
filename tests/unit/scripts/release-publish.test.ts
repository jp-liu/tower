import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../../..");
const commit = "a".repeat(40);
const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function executable(file: string, source: string) {
  writeFileSync(file, source);
  chmodSync(file, 0o755);
}

function runRelease(
  mode: "existing" | "conflict" | "absent" | "lookup-failure",
  publishExit = 0,
  metadataVersion = "0.4.1",
) {
  const root = mkdtempSync(path.join(tmpdir(), "tower-release-publish-test-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  const log = path.join(root, "npm.log");
  const tarball = path.join(root, "tower.tgz");
  const integrity = `sha512-${createHash("sha512").update("package").digest("base64")}`;
  mkdirSync(bin);
  writeFileSync(log, "");
  writeFileSync(tarball, "package");
  executable(path.join(bin, "pnpm"), `#!/bin/sh
printf 'pnpm %s\\n' "$*" >> "$NPM_TEST_LOG"
exit 97
`);
  executable(path.join(bin, "git"), `#!/bin/sh
case "$1:$2" in
  rev-parse:HEAD|rev-list:-n) printf '%s\\n' '${commit}' ;;
  status:--porcelain) ;;
  remote:get-url) printf '%s\\n' 'https://github.com/tower-org/tower.git' ;;
  grep:*) exit 1 ;;
  *) printf 'unexpected git call: %s\\n' "$*" >&2; exit 2 ;;
esac
`);
  executable(path.join(bin, "npm"), `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$NPM_TEST_LOG"
case "$1" in
  pack)
    printf '[{"name":"@tower-org/cli","version":"%s","integrity":"%s"}]\\n' "$NPM_TEST_METADATA_VERSION" "$NPM_TEST_INTEGRITY"
    ;;
  view)
    case "$*" in
      *' dist.integrity '*)
        case "$NPM_TEST_MODE" in
          existing) printf '%s\\n' "$NPM_TEST_INTEGRITY" ;;
          conflict) printf '%s\\n' 'sha512-conflicting-bytes' ;;
          *) exit 2 ;;
        esac ;;
      *)
        case "$NPM_TEST_MODE" in
          existing|conflict) printf '%s\\n' '0.4.1' ;;
          absent) printf '%s\\n' 'npm error code E404' >&2; exit 1 ;;
          lookup-failure) printf '%s\\n' 'npm error code EAI_AGAIN' >&2; exit 1 ;;
        esac ;;
    esac ;;
  publish) exit "$NPM_TEST_PUBLISH_EXIT" ;;
  *) exit 2 ;;
esac
`);
  const result = spawnSync("bash", ["scripts/release.sh", "--publish", "--tarball", tarball], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_SHA: "",
      GITHUB_WORKFLOW_SHA: "",
      GITHUB_REF: "",
      PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
      TOWER_RELEASE_APPROVED: "@tower-org/cli@0.4.1",
      TOWER_RELEASE_TAG: "v0.4.1",
      TOWER_RELEASE_COMMIT: commit,
      NPM_TEST_LOG: log,
      NPM_TEST_MODE: mode,
      NPM_TEST_PUBLISH_EXIT: String(publishExit),
      NPM_TEST_INTEGRITY: integrity,
      NPM_TEST_METADATA_VERSION: metadataVersion,
    },
  });
  return { ...result, calls: readFileSync(log, "utf8") };
}

describe("npm release recovery boundary", () => {
  it("reuses only an existing publication with the exact prepared bytes", () => {
    const result = runRelease("existing");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Verified existing npm publication");
    expect(result.calls).not.toMatch(/^npm publish /m);
    expect(result.calls).not.toMatch(/^pnpm /m);
  });

  it("rejects an existing package with different bytes", () => {
    const result = runRelease("conflict");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("different dist.integrity");
    expect(result.calls).not.toMatch(/^npm publish /m);
  });

  it("publishes only after npm explicitly reports E404", () => {
    const result = runRelease("absent");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Confirmed @tower-org/cli@0.4.1 is absent");
    expect(result.calls).toMatch(/^npm publish .*tower\.tgz/m);
    expect(result.calls).not.toMatch(/^pnpm /m);
  });

  it("does not publish when the npm lookup fails ambiguously", () => {
    const result = runRelease("lookup-failure");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("could not prove @tower-org/cli@0.4.1 is absent");
    expect(result.calls).not.toMatch(/^npm publish /m);
  });

  it("propagates npm publish failure without attempting another channel", () => {
    const result = runRelease("absent", 23);
    expect(result.status).toBe(23);
    expect(result.calls.match(/^npm publish /gm)).toHaveLength(1);
  });

  it("rejects a prepared tarball with a different package identity", () => {
    const result = runRelease("absent", 0, "0.4.2");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Tarball identity mismatch");
    expect(result.calls).not.toMatch(/^npm view /m);
    expect(result.calls).not.toMatch(/^npm publish /m);
  });
});
