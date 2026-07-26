import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CliPluginRuntime,
  FixtureExtensionCatalog,
  PrebuiltArtifactProvider,
  assertCatalogJsonSchema,
  parseExtensionCatalog,
  type ExtensionCatalogIndexV1,
} from "@tower-org/ai-runtime";

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

export async function assertJsonSchema(
  value: unknown,
  schemaPath: string,
  label: string,
): Promise<void> {
  const schema = await readJson(schemaPath);
  assertCatalogJsonSchema(value, schema, label);
}

export async function validateGeneratedExtensionCatalog(options: {
  repoRoot: string;
  inputDir: string;
}): Promise<ExtensionCatalogIndexV1> {
  const indexPath = path.join(options.inputDir, "index.v1.json");
  const rawIndex = await readJson(indexPath);
  await assertJsonSchema(
    rawIndex,
    path.join(options.repoRoot, "extensions/catalog/schema/catalog-index.v1.schema.json"),
    "Generated extension catalog",
  );
  const index = parseExtensionCatalog(rawIndex);
  const artifactContents = new Map<string, Uint8Array>();
  for (const extension of index.extensions) {
    for (const release of extension.versions) {
      const artifactName = `${extension.id}-${release.version}.tgz`;
      artifactContents.set(
        release.artifact.url,
        await fs.readFile(path.join(options.inputDir, "artifacts", artifactName)),
      );
    }
  }

  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-catalog-validation-"));
  try {
    const packageJson = await readJson(path.join(options.repoRoot, "package.json")) as { version?: unknown };
    const runtime = new CliPluginRuntime({
      dataRoot,
      towerVersion: typeof packageJson.version === "string" ? packageJson.version : "0.0.0",
      artifactProvider: new PrebuiltArtifactProvider({
        fetchImpl: async (url) => {
          const contents = artifactContents.get(url);
          if (!contents) return new Response(null, { status: 404 });
          return new Response(
            contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength) as ArrayBuffer,
            {
              status: 200,
              headers: { "content-length": String(contents.byteLength) },
            },
          );
        },
      }),
      cliDependencyVerifier: {
        verify: async (manifest) => ({
          dependency: manifest.cliDependency.name,
          state: "ready",
          commandPath: `/ci/${manifest.command.default}`,
          detectedVersion: "ci-validation",
          supportedVersions: manifest.cliDependency.supportedVersions,
          homepage: manifest.cliDependency.homepage,
          installDocs: manifest.cliDependency.installDocs,
          managedByTower: false,
        }),
      },
    });
    const catalog = new FixtureExtensionCatalog(index);
    for (const extension of index.extensions) {
      for (const release of extension.versions) {
        await runtime.planCatalogInstall(catalog, extension.id, release.version);
      }
    }
    return index;
  } finally {
    await fs.rm(dataRoot, { recursive: true, force: true });
  }
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const repoRoot = path.resolve(path.dirname(currentFile), "..");
  const inputDir = option("--input");
  if (!inputDir) throw new Error("Pass --input with a generated catalog directory");
  validateGeneratedExtensionCatalog({
    repoRoot,
    inputDir: path.resolve(inputDir),
  }).then((index) => {
    process.stdout.write(`Validated ${index.extensions.length} extension(s)\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
