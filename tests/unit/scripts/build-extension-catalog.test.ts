// @vitest-environment node
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import { parseExtensionCatalog } from "@tower-org/ai-runtime";
import { buildExtensionCatalog } from "../../../scripts/build-extension-catalog";
import {
  assertJsonSchema,
  validateGeneratedExtensionCatalog,
} from "../../../scripts/validate-extension-catalog.mjs";

const roots: string[] = [];
const repoRoot = path.resolve(import.meta.dirname, "../../..");
type InvalidIndexFields = Partial<{
  artifactUrl: string;
  sha256: string;
  size: number;
  version: string;
  installDocs: string;
}>;

const invalidIndexCases: Array<[string, InvalidIndexFields]> = [
  ["an HTTP artifact URL", { artifactUrl: "http://catalog.invalid/provider.tgz" }],
  ["an invalid artifact digest", { sha256: "ABC123" }],
  ["a zero-byte artifact", { size: 0 }],
  ["a non-exact semantic version", { version: "01.0.0" }],
  ["HTTP CLI install documentation", { installDocs: "http://catalog.invalid/install" }],
];

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
    await expect(validateGeneratedExtensionCatalog({ repoRoot, inputDir: first }))
      .resolves.toEqual(firstIndex);

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

  it.each(invalidIndexCases)("rejects nested index data with %s", async (_name, invalid) => {
    const index = {
      schemaVersion: 1,
      extensions: [{
        id: "community.fixture",
        kind: "cli-provider",
        publisher: { id: "fixture-publisher", name: "Fixture Publisher" },
        display: { name: "Fixture Provider", homepage: "https://example.test/provider" },
        versions: [{
          version: invalid.version ?? "1.0.0",
          artifact: {
            url: invalid.artifactUrl ?? "https://catalog.example.test/provider.tgz",
            sha256: invalid.sha256 ?? "a".repeat(64),
            size: invalid.size ?? 1,
          },
          cliDependency: {
            name: "Fixture CLI",
            supportedVersions: ">=1.0.0 <2.0.0",
            installDocs: invalid.installDocs ?? "https://example.test/install",
          },
        }],
      }],
    };
    const schemaPath = path.join(
      repoRoot,
      "extensions/catalog/schema/catalog-index.v1.schema.json",
    );

    await expect(assertJsonSchema(index, schemaPath, "Fixture catalog"))
      .rejects.toThrow("JSON Schema");
    expect(() => parseExtensionCatalog(index)).toThrowError(
      expect.objectContaining({ code: "CATALOG_INVALID" }),
    );
  });

  it("keeps the source schema and generator aligned on nested safety constraints", async () => {
    const rawSource = JSON.parse(await fs.readFile(
      path.join(repoRoot, "extensions/catalog/sources/qwen-code.json"),
      "utf8",
    )) as {
      extension: {
        publisher: { name: string };
        display: { homepage: string };
        versions: string[];
      };
    };
    const invalidSources = [
      { ...structuredClone(rawSource), extension: { ...structuredClone(rawSource.extension), publisher: { ...rawSource.extension.publisher, name: "   " } } },
      { ...structuredClone(rawSource), extension: { ...structuredClone(rawSource.extension), display: { ...rawSource.extension.display, homepage: "http://example.test/qwen" } } },
      { ...structuredClone(rawSource), extension: { ...structuredClone(rawSource.extension), versions: ["01.0.0"] } },
      { ...structuredClone(rawSource), extension: { ...structuredClone(rawSource.extension), versions: [" 0.1.0 "] } },
      { ...structuredClone(rawSource), extension: { ...structuredClone(rawSource.extension), versions: ["0.1.0", "0.1.0"] } },
    ];
    const schemaPath = path.join(
      repoRoot,
      "extensions/catalog/schema/catalog-source.schema.json",
    );
    for (const invalid of invalidSources) {
      await expect(assertJsonSchema(invalid, schemaPath, "Fixture source"))
        .rejects.toThrow("JSON Schema");
    }

    const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "tower-catalog-invalid-source-"));
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "tower-catalog-invalid-output-"));
    roots.push(sourceDir, outputDir);
    for (const invalid of invalidSources) {
      await fs.writeFile(path.join(sourceDir, "invalid.json"), JSON.stringify(invalid));
      await expect(buildExtensionCatalog({
        repoRoot,
        sourceDir,
        outputDir,
        baseUrl: "https://catalog.example.test/releases/",
      })).rejects.toThrow("Invalid catalog source");
    }
  });
});
