import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";
import { z } from "zod";
import {
  isHttpsUrl,
  parseExtensionCatalog,
  type CatalogExtension,
  type ExtensionCatalogIndexV1,
} from "../packages/ai-runtime/src/catalog.js";

interface CatalogSource {
  schemaVersion: 1;
  packageDir: string;
  extension: Omit<CatalogExtension, "versions"> & { versions: string[] };
}

const EXACT_SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const stableIdSchema = z.string().min(1).max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const nonEmptyStringSchema = z.string().refine((value) => value.trim().length > 0);
const httpsUrlSchema = z.string().refine(isHttpsUrl);
const exactVersionSchema = z.string().regex(EXACT_SEMVER_PATTERN);

const catalogSourceSchema = z.object({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  packageDir: nonEmptyStringSchema,
  extension: z.object({
    id: stableIdSchema,
    kind: z.literal("cli-provider"),
    publisher: z.object({
      id: stableIdSchema,
      name: nonEmptyStringSchema,
    }).strict(),
    display: z.object({
      name: nonEmptyStringSchema,
      description: z.string().optional(),
      homepage: httpsUrlSchema.optional(),
    }).strict(),
    versions: z.array(exactVersionSchema).min(1)
      .refine((versions) => new Set(versions).size === versions.length),
  }).strict(),
}).strict();

export interface BuildExtensionCatalogOptions {
  repoRoot: string;
  sourceDir: string;
  outputDir: string;
  baseUrl: string;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
}

async function listFiles(root: string, relative = ""): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.posix.join(relative.replaceAll(path.sep, "/"), entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else throw new Error(`Unsupported artifact entry: ${child}`);
  }
  return files;
}

async function atomicWrite(filePath: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await fs.writeFile(temporary, contents);
  await fs.rename(temporary, filePath);
}

function packagePath(repoRoot: string, relative: string): string {
  const resolved = path.resolve(repoRoot, relative);
  const prefix = `${path.resolve(repoRoot)}${path.sep}`;
  if (!resolved.startsWith(prefix)) throw new Error("Catalog packageDir must stay inside the repository");
  return resolved;
}

export async function buildExtensionCatalog(
  options: BuildExtensionCatalogOptions,
): Promise<ExtensionCatalogIndexV1> {
  const baseUrl = new URL(options.baseUrl);
  if (baseUrl.protocol !== "https:") throw new Error("Catalog artifact base URL must use HTTPS");
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";

  const sourceFiles = (await fs.readdir(options.sourceDir))
    .filter((entry) => entry.endsWith(".json"))
    .sort();
  const sources = await Promise.all(sourceFiles.map(async (entry) => {
    const value = await readJson(path.join(options.sourceDir, entry));
    const parsed = catalogSourceSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Invalid catalog source: ${entry}`);
    return structuredClone(parsed.data) as CatalogSource;
  }));

  await fs.mkdir(path.join(options.outputDir, "artifacts"), { recursive: true });
  const extensions: CatalogExtension[] = [];
  for (const source of sources.sort((left, right) => left.extension.id.localeCompare(right.extension.id))) {
    const root = packagePath(options.repoRoot, source.packageDir);
    const packageJson = await readJson(path.join(root, "package.json")) as Record<string, unknown>;
    const manifest = packageJson.tower as Record<string, unknown> | undefined;
    if (!manifest
      || manifest.id !== source.extension.id
      || JSON.stringify(manifest.publisher) !== JSON.stringify(source.extension.publisher)) {
      throw new Error(`Catalog identity does not match package manifest: ${source.extension.id}`);
    }
    const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "";
    const releases = [];
    for (const version of [...source.extension.versions].sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))) {
      if (version !== packageVersion) {
        throw new Error(`Catalog source version ${version} has no matching package snapshot`);
      }
      const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tower-catalog-build-"));
      try {
        const packageRoot = path.join(temporaryRoot, "package");
        await fs.mkdir(packageRoot, { recursive: true });
        await fs.cp(path.join(root, "dist"), path.join(packageRoot, "dist"), { recursive: true });
        await fs.copyFile(path.join(root, "config.schema.json"), path.join(packageRoot, "config.schema.json"));
        const artifactPackage = {
          name: packageJson.name,
          version,
          type: "module",
          exports: packageJson.exports,
          tower: manifest,
        };
        await fs.writeFile(
          path.join(packageRoot, "package.json"),
          `${JSON.stringify(artifactPackage, null, 2)}\n`,
        );
        const archive = path.join(temporaryRoot, "artifact.tgz");
        const files = (await listFiles(packageRoot)).map((entry) => `package/${entry}`);
        await tar.c({
          cwd: temporaryRoot,
          file: archive,
          gzip: { level: 9 },
          noMtime: true,
          portable: true,
        }, files);
        const bytes = await fs.readFile(archive);
        const artifactName = `${source.extension.id}-${version}.tgz`;
        await atomicWrite(path.join(options.outputDir, "artifacts", artifactName), bytes);
        const dependency = manifest.cliDependency as Record<string, unknown>;
        releases.push({
          version,
          artifact: {
            url: new URL(`artifacts/${artifactName}`, baseUrl).href,
            sha256: sha256(bytes),
            size: bytes.byteLength,
          },
          cliDependency: {
            name: String(dependency.name),
            supportedVersions: String(dependency.supportedVersions),
            installDocs: String(dependency.installDocs),
          },
        });
      } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
      }
    }
    extensions.push({ ...source.extension, versions: releases });
  }
  const index = parseExtensionCatalog({ schemaVersion: 1, extensions });
  await atomicWrite(path.join(options.outputDir, "index.v1.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const repoRoot = path.resolve(path.dirname(currentFile), "..");
  const baseUrl = option("--base-url") ?? process.env.TOWER_EXTENSION_CATALOG_BASE_URL;
  if (!baseUrl) throw new Error("Pass --base-url or TOWER_EXTENSION_CATALOG_BASE_URL");
  buildExtensionCatalog({
    repoRoot,
    sourceDir: path.join(repoRoot, "extensions/catalog/sources"),
    outputDir: path.resolve(option("--output") ?? path.join(repoRoot, "extensions/catalog/generated")),
    baseUrl,
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
