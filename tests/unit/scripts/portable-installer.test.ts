import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
const tar = require("tar");
const roots: string[] = [];

function payload(parent: string, version: string, rootName = `payload-${version}`) {
  const root = path.join(parent, rootName);
  mkdirSync(path.join(root, "runtime/package/bin"), { recursive: true });
  cpSync(path.join(projectRoot, "scripts/portable/install"), path.join(root, "install"));
  cpSync(path.join(projectRoot, "scripts/portable/tower"), path.join(root, "bin/tower"));
  chmodSync(path.join(root, "install"), 0o755);
  chmodSync(path.join(root, "bin/tower"), 0o755);
  writeFileSync(path.join(root, "runtime/package/bin/tower.mjs"), `console.log("tower v${version}");\n`);
  const platform = process.platform === "win32" ? "windows" : process.platform;
  writeFileSync(path.join(root, "portable-manifest.json"), JSON.stringify({
    version, platform, arch: process.arch,
    node: { minimum: "22.0.0", tested: ["22", "24"], knownIncompatible: [] },
  }));
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe.runIf(process.platform !== "win32")("portable user installer", () => {
  it("installs, upgrades, rolls back, and uninstalls without touching user data", () => {
    const temp = mkdtempSync(path.join(tmpdir(), "tower-installer-test-"));
    roots.push(temp);
    const installRoot = path.join(temp, "install root");
    const binDir = path.join(temp, "bin");
    const dataDir = path.join(temp, ".tower");
    mkdirSync(dataDir);
    const env = { ...process.env, HOME: temp, TOWER_DATA_DIR: dataDir };
    const run = (script: string, args: string[]) => execFileSync(script, args, { env, encoding: "utf8" });

    const first = payload(temp, "0.3.0");
    const second = payload(temp, "0.3.1");
    run(path.join(first, "install"), ["--prefix", installRoot, "--bin-dir", binDir, "--yes", "--no-start"]);
    run(path.join(second, "install"), ["--prefix", installRoot, "--bin-dir", binDir, "--yes", "--no-start"]);
    expect(readlinkSync(path.join(installRoot, "current"))).toContain("0.3.1");
    expect(readlinkSync(path.join(installRoot, "previous"))).toContain("0.3.0");

    run(path.join(installRoot, "current/install"), ["--rollback", "--prefix", installRoot, "--bin-dir", binDir, "--yes"]);
    expect(readlinkSync(path.join(installRoot, "current"))).toContain("0.3.0");
    expect(run(path.join(binDir, "tower"), ["--version"]).trim()).toBe("tower v0.3.0");

    run(path.join(installRoot, "current/install"), ["--uninstall", "--prefix", installRoot, "--bin-dir", binDir, "--yes"]);
    expect(existsSync(installRoot)).toBe(false);
    expect(existsSync(dataDir)).toBe(true);
  });

  it("verifies an offline archive and checksum through the public installer", async () => {
    const temp = mkdtempSync(path.join(tmpdir(), "tower-download-installer-test-"));
    roots.push(temp);
    const platform = process.platform;
    const rootName = `tower-v0.3.1-${platform}-${process.arch}`;
    payload(temp, "0.3.1", rootName);
    const asset = `tower-portable-${platform}-${process.arch}.tar.gz`;
    await tar.c({ cwd: temp, gzip: true, file: path.join(temp, asset) }, [rootName]);
    const digest = createHash("sha256").update(readFileSync(path.join(temp, asset))).digest("hex");
    writeFileSync(path.join(temp, "SHA256SUMS"), `${digest}  ${asset}\n`);

    const output = execFileSync("sh", [
      path.join(projectRoot, "scripts/install.sh"),
      "--asset-dir", temp,
      "--version", "0.3.1",
      "--verify",
      "--yes",
      "--no-start",
    ], { encoding: "utf8" });
    expect(output).toContain("Portable Tower payload verified.");
  });
});
