// @vitest-environment node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { parseExtensionCatalog } from "@tower/ai-runtime";
import { buildExtensionCatalog } from "../../../scripts/build-extension-catalog";

const roots: string[] = [];
const repoRoot = path.resolve(import.meta.dirname, "../../..");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("extension catalog generator", () => {
  it("generates deterministic prebuilt artifacts and a validated v1 index", async () => {
    const first = await fs.mkdtemp(path.join(os.tmpdir(), "tower-catalog-first-"));
    const second = await fs.mkdtemp(path.join(os.tmpdir(), "tower-catalog-second-"));
    roots.push(first, second);
    const options = {
      repoRoot,
      sourceDir: path.join(repoRoot, "extensions/catalog/sources"),
      baseUrl: "https://catalog.example.test/releases/",
    };
    const firstIndex = await buildExtensionCatalog({ ...options, outputDir: first });
    const secondIndex = await buildExtensionCatalog({ ...options, outputDir: second });
    expect(parseExtensionCatalog(firstIndex)).toEqual(firstIndex);
    expect(secondIndex).toEqual(firstIndex);

    const artifactName = "community.qwen-code-0.1.0.tgz";
    const firstBytes = await fs.readFile(path.join(first, "artifacts", artifactName));
    const secondBytes = await fs.readFile(path.join(second, "artifacts", artifactName));
    expect(firstBytes.equals(secondBytes)).toBe(true);
    expect(firstIndex.extensions[0]).toMatchObject({
      id: "community.qwen-code",
      publisher: { id: "tower-community", name: "Tower Community" },
      versions: [{
        version: "0.1.0",
        artifact: {
          url: `https://catalog.example.test/releases/artifacts/${artifactName}`,
          sha256: createHash("sha256").update(firstBytes).digest("hex"),
          size: firstBytes.byteLength,
        },
        cliDependency: { name: "Qwen Code CLI", supportedVersions: ">=0.18.0 <1.0.0" },
      }],
    });

    const extractRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-catalog-extract-"));
    roots.push(extractRoot);
    await tar.x({ cwd: extractRoot, file: path.join(first, "artifacts", artifactName) });
    const artifactPackage = JSON.parse(await fs.readFile(
      path.join(extractRoot, "package", "package.json"),
      "utf8",
    ));
    expect(artifactPackage.scripts).toBeUndefined();
    expect(artifactPackage.dependencies).toBeUndefined();
    expect(artifactPackage.devDependencies).toBeUndefined();
    expect(await fs.readFile(path.join(extractRoot, "package", "dist", "index.js"), "utf8"))
      .toContain("community.qwen-code");
  });

  it("rejects a non-HTTPS publication base", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "tower-catalog-http-"));
    roots.push(outputDir);
    await expect(buildExtensionCatalog({
      repoRoot,
      sourceDir: path.join(repoRoot, "extensions/catalog/sources"),
      outputDir,
      baseUrl: "http://catalog.invalid/",
    })).rejects.toThrow("HTTPS");
  });
});
