import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isWindows } from "@/lib/platform";

const require = createRequire(import.meta.url);
const { assertPortableRoot } = require("../../../scripts/release-portable-canary.js");
const {
  createNpmInstallInvocation,
  normalizePrismaGeneratedPaths,
  normalizePrismaGeneratedSource,
  runNpmInstall,
  temporaryBuildPathContext,
} = require("../../../scripts/build-portable-release.js");
const roots: string[] = [];

const npmInstallArgs = [
  "ci",
  "--omit=dev",
  "--include=optional",
  "--no-audit",
  "--no-fund",
  "--foreground-scripts",
  "--registry=https://registry.npmjs.org/",
];

function file(root: string, relative: string, content = "fixture") {
  const target = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "tower-portable-build-test-"));
  roots.push(root);
  const packageRoot = "runtime/package";
  const platform = isWindows() ? "windows" : process.platform;
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

describe("portable release npm installation", () => {
  it("runs npm.cmd through ComSpec on Windows without changing npm arguments", () => {
    const invocation = createNpmInstallInvocation("win32", {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    });

    expect(invocation).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", ...npmInstallArgs],
    });
    expect(invocation.command).not.toMatch(/\.cmd$/i);
  });

  it("runs npm directly on Unix and preserves the same npm arguments", () => {
    const unix = createNpmInstallInvocation("linux", {});
    const windows = createNpmInstallInvocation("win32", {});

    expect(unix).toEqual({ command: "npm", args: npmInstallArgs });
    expect(windows.command).toBe("cmd.exe");
    expect(windows.args.slice(4)).toEqual(unix.args);
  });

  it("passes cwd and environment to ComSpec and preserves command failures", () => {
    const env = { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "C:\\npm" };
    const failure = Object.assign(new Error("npm exited with status 37"), { status: 37 });
    let invocation: unknown;

    expect(() => runNpmInstall({
      cwd: "C:\\payload",
      cacheDir: "C:\\cache",
      platform: "win32",
      env,
      execute: (command: string, args: string[], options: unknown) => {
        invocation = { command, args, options };
        throw failure;
      },
    })).toThrow(failure);
    expect(invocation).toEqual({
      command: env.ComSpec,
      args: ["/d", "/s", "/c", "npm.cmd", ...npmInstallArgs],
      options: {
        cwd: "C:\\payload",
        stdio: "inherit",
        env: { ...env, npm_config_cache: "C:\\cache" },
      },
    });
  });
});

describe("portable Prisma path normalization", () => {
  it("normalizes Windows short and long roots in slash and JSON-escaped forms", () => {
    const shortRoot = String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\tower-portable-build-yerjFc\tower-v0.3.1-windows-x64\runtime\package`;
    const longRoot = String.raw`C:\Users\runneradmin\AppData\Local\Temp\tower-portable-build-yerjFc\tower-v0.3.1-windows-x64\runtime\package`;
    const sources = [
      JSON.stringify({ sourceFilePath: `${shortRoot}\\prisma\\schema.prisma` }),
      `const sourceFilePath = String.raw\`${longRoot}\\prisma\\schema.prisma\`;`,
      `const sourceFilePath = "${shortRoot.replaceAll("\\", "/")}/prisma/schema.prisma";`,
    ];

    for (const source of sources) {
      const normalized = normalizePrismaGeneratedSource(source, [shortRoot, longRoot]);
      expect(normalized).toContain("/tower-portable/runtime/package");
      expect(normalized).not.toContain("tower-portable-build-");
      expect(normalized).not.toContain("RUNNER~1");
      expect(normalized).not.toContain("runneradmin");
    }
  });

  it("normalizes the relative traversal emitted by Prisma without consuming its suffix", () => {
    const relativeRoot = String.raw`.\..\..\..\..\runneradmin\AppData\Local\Temp\tower-portable-build-84VlnQ\tower-v0.3.1-windows-x64\runtime\package`;
    const sources = [
      JSON.stringify({ sourceFilePath: `${relativeRoot}\\prisma\\schema.prisma` }),
      `const sourceFilePath = String.raw\`${relativeRoot}\\prisma\\schema.prisma\`;`,
      `const sourceFilePath = "${relativeRoot.replaceAll("\\", "/")}/prisma/schema.prisma";`,
    ];

    for (const source of sources) {
      const normalized = normalizePrismaGeneratedSource(source, []);
      expect(normalized).toContain("/tower-portable/runtime/package");
      expect(normalized).toContain("prisma");
      expect(normalized).toContain("schema.prisma");
      expect(normalized).not.toContain("tower-portable-build-");
      expect(normalized).not.toContain("runneradmin");
    }
  });

  it("does not rewrite unbounded temporary build markers", () => {
    const source = "const diagnostic = 'tower-portable-build-leaked/runtime/package';";
    expect(normalizePrismaGeneratedSource(source, [])).toBe(source);
  });

  it("limits and JSON-escapes residual marker diagnostics", () => {
    const source = `before-sentinel${"x".repeat(200)}\\tower-portable-build-leaked\\${"y".repeat(200)}after-sentinel`;
    const context = temporaryBuildPathContext(source, 40);

    expect(context).toContain("tower-portable-build-leaked");
    expect(context).toContain("\\\\tower-portable-build-leaked\\\\");
    expect(context).not.toContain("before-sentinel");
    expect(context).not.toContain("after-sentinel");
    expect(JSON.parse(context)).toMatch(/^\.\.\..*\.\.\.$/);
  });

  it("includes only bounded marker context when a generated file still fails", () => {
    const { root, manifest } = fixture();
    const packageRoot = path.join(root, ...manifest.packageRoot.split("/"));
    const source = `before-sentinel${"x".repeat(200)}\\tower-portable-build-unmatched\\${"y".repeat(200)}after-sentinel`;
    file(root, `${manifest.packageRoot}/node_modules/.prisma/client/edge.js`, source);
    let message = "";

    try {
      normalizePrismaGeneratedPaths(packageRoot);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("temporary build path: edge.js; context=\"");
    expect(message).toContain("\\\\tower-portable-build-unmatched\\\\");
    expect(message).not.toContain("before-sentinel");
    expect(message).not.toContain("after-sentinel");
  });
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

  it("removes temporary build roots from every generated Prisma entry", () => {
    const { root, manifest } = fixture();
    const packageRoot = path.join(root, ...manifest.packageRoot.split("/"));
    const relativeRoot = String.raw`.\..\..\..\..\..\..\..\..\runneradmin\AppData\Local\Temp\tower-portable-build-84VlnQ\tower-v0.3.1-windows-x64\runtime\package`;
    const sources = {
      "edge.js": JSON.stringify({ sourceFilePath: `${relativeRoot}\\prisma\\schema.prisma` }),
      "index.js": `const sourceFilePath = String.raw\`${relativeRoot}\\prisma\\schema.prisma\`;`,
      "wasm.js": `const sourceFilePath = "${relativeRoot.replaceAll("\\", "/")}/prisma/schema.prisma";`,
    };
    for (const [name, source] of Object.entries(sources)) {
      file(root, `${manifest.packageRoot}/node_modules/.prisma/client/${name}`, source);
    }

    normalizePrismaGeneratedPaths(packageRoot);
    for (const name of Object.keys(sources)) {
      const generated = readFileSync(path.join(packageRoot, "node_modules/.prisma/client", name), "utf8");
      expect(generated).toContain("/tower-portable/runtime/package");
      expect(generated).toContain("prisma");
      expect(generated).toContain("schema.prisma");
      expect(generated).not.toContain("tower-portable-build-");
      expect(generated).not.toContain("runneradmin");
    }
  });
});
