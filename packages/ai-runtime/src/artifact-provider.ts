import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import * as tar from "tar";
import type { CatalogArtifact, CatalogFetch } from "./catalog.js";
import { isHttpsUrl, MAX_EXTENSION_ARTIFACT_BYTES } from "./catalog.js";
import { pluginError } from "./plugin-errors.js";
import type { PluginFileSystem } from "./plugin-filesystem.js";
import { NodePluginFileSystem } from "./plugin-filesystem.js";

export interface ExtensionArtifactProvider {
  stage(artifact: CatalogArtifact, destination: string): Promise<void>;
}

export const MAX_EXTENSION_ARCHIVE_ENTRIES = 4_096;
export const MAX_EXTENSION_ARCHIVE_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_EXTENSION_ARCHIVE_EXPANDED_BYTES = 256 * 1024 * 1024;

export interface ExtensionArchiveLimits {
  maxEntries: number;
  maxFileBytes: number;
  maxExpandedBytes: number;
}

export function assertSafeArtifactPath(entryPath: string): void {
  if (!entryPath || entryPath.includes("\0")
    || path.posix.isAbsolute(entryPath)
    || path.win32.isAbsolute(entryPath)) throw pluginError("UNSAFE_ARCHIVE");
  const normalized = entryPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (segments[0] !== "package"
    || segments.slice(1).some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw pluginError("UNSAFE_ARCHIVE");
  }
}

type TarEntry = Parameters<tar.Parser["filter"]>[1];

function boundedLimit(value: number | undefined, hardLimit: number): number {
  const resolved = value ?? hardLimit;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > hardLimit) {
    throw pluginError("ARTIFACT_INVALID");
  }
  return resolved;
}

function createArchiveFilter(limits: ExtensionArchiveLimits, onReject?: (error: Error) => void) {
  let rejected: unknown;
  let entries = 0;
  let expandedBytes = 0;
  const paths = new Set<string>();

  const reject = (error: unknown) => {
    if (rejected) return;
    rejected = error;
    onReject?.(error instanceof Error ? error : pluginError("UNSAFE_ARCHIVE"));
  };

  const acceptSize = (size: number) => {
    entries += 1;
    if (!Number.isSafeInteger(size)
      || size < 0
      || entries > limits.maxEntries
      || size > limits.maxFileBytes
      || expandedBytes > limits.maxExpandedBytes - size) {
      throw pluginError("UNSAFE_ARCHIVE");
    }
    expandedBytes += size;
  };

  return {
    filter(entryPath: string, entry: TarEntry): boolean {
      try {
        assertSafeArtifactPath(entryPath);
        if (!("type" in entry)
          || (entry.type !== "File" && entry.type !== "Directory" && entry.type !== "OldFile")
          || !("size" in entry)
          || ("invalid" in entry && entry.invalid)
          || ("unsupported" in entry && entry.unsupported)) {
          throw pluginError("UNSAFE_ARCHIVE");
        }
        const normalizedPath = entryPath.replace(/\\/g, "/").replace(/\/+$/, "");
        if (paths.has(normalizedPath)) throw pluginError("UNSAFE_ARCHIVE");
        paths.add(normalizedPath);
        if (entry.type === "Directory") {
          if (entry.size !== 0) throw pluginError("UNSAFE_ARCHIVE");
          acceptSize(0);
          return true;
        }
        acceptSize(entry.size);
        return true;
      } catch (error) {
        reject(error);
        return false;
      }
    },
    acceptMetadata(contents: string): void {
      try {
        acceptSize(Buffer.byteLength(contents));
      } catch (error) {
        reject(error);
      }
    },
    assertAccepted(): void {
      if (rejected) throw rejected;
    },
  };
}

async function inspectArtifact(tarballPath: string, limits: ExtensionArchiveLimits): Promise<void> {
  let parser!: tar.Parser;
  const validator = createArchiveFilter(limits, (error) => {
    queueMicrotask(() => parser.abort(error));
  });
  try {
    parser = new tar.Parser({
      strict: true,
      maxMetaEntrySize: Math.min(limits.maxFileBytes, limits.maxExpandedBytes),
      filter: validator.filter,
      onReadEntry: (entry) => entry.resume(),
    });
    parser.on("meta", (contents: string) => validator.acceptMetadata(contents));
    await pipeTarball(tarballPath, parser, "end");
    validator.assertAccepted();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "UNSAFE_ARCHIVE") throw error;
    throw pluginError("UNSAFE_ARCHIVE", undefined, error);
  }
}

async function pipeTarball(
  tarballPath: string,
  target: tar.Parser,
  completionEvent: "end" | "close",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(tarballPath);
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      input.destroy();
      if (error) reject(error);
      else resolve();
    };
    input.once("error", finish);
    target.once("error", finish);
    target.once(completionEvent, () => finish());
    input.pipe(target as unknown as NodeJS.WritableStream);
  });
}

async function inspectExtractedTree(
  fileSystem: PluginFileSystem,
  destination: string,
  limits: ExtensionArchiveLimits,
): Promise<void> {
  let entries = 0;
  let expandedBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fileSystem.readdir(directory)) {
      entries += 1;
      if (entries > limits.maxEntries) throw pluginError("UNSAFE_ARCHIVE");
      const entryPath = path.join(directory, entry.name);
      const stats = await fileSystem.lstat(entryPath);
      if (stats.isSymbolicLink()) throw pluginError("UNSAFE_ARCHIVE");
      if (stats.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!stats.isFile()
        || !Number.isSafeInteger(stats.size)
        || stats.size < 0
        || stats.size > limits.maxFileBytes
        || expandedBytes > limits.maxExpandedBytes - stats.size) {
        throw pluginError("UNSAFE_ARCHIVE");
      }
      expandedBytes += stats.size;
    }
  };
  await visit(destination);
}

export interface PrebuiltArtifactProviderOptions {
  fetchImpl?: CatalogFetch;
  fileSystem?: PluginFileSystem;
  maxBytes?: number;
  maxArchiveEntries?: number;
  maxArchiveFileBytes?: number;
  maxArchiveExpandedBytes?: number;
}

async function readArtifactBody(response: Response, expectedBytes: number, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) throw pluginError("ARTIFACT_DOWNLOAD_FAILED");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedBytes || total > maxBytes) throw pluginError("ARTIFACT_SIZE_MISMATCH");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) throw pluginError("ARTIFACT_SIZE_MISMATCH");
  const contents = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    contents.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return contents;
}

export class PrebuiltArtifactProvider implements ExtensionArtifactProvider {
  private readonly fetchImpl: CatalogFetch;
  private readonly fileSystem: PluginFileSystem;
  private readonly maxBytes: number;
  private readonly archiveLimits: ExtensionArchiveLimits;

  constructor(options: PrebuiltArtifactProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.fileSystem = options.fileSystem ?? new NodePluginFileSystem();
    this.maxBytes = boundedLimit(options.maxBytes, MAX_EXTENSION_ARTIFACT_BYTES);
    this.archiveLimits = {
      maxEntries: boundedLimit(options.maxArchiveEntries, MAX_EXTENSION_ARCHIVE_ENTRIES),
      maxFileBytes: boundedLimit(options.maxArchiveFileBytes, MAX_EXTENSION_ARCHIVE_FILE_BYTES),
      maxExpandedBytes: boundedLimit(options.maxArchiveExpandedBytes, MAX_EXTENSION_ARCHIVE_EXPANDED_BYTES),
    };
  }

  async stage(artifact: CatalogArtifact, destination: string): Promise<void> {
    if (!isHttpsUrl(artifact.url)
      || !Number.isSafeInteger(artifact.size)
      || artifact.size <= 0
      || artifact.size > this.maxBytes
      || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw pluginError("ARTIFACT_INVALID");
    let response: Response;
    try {
      response = await this.fetchImpl(artifact.url, { redirect: "follow" });
    } catch (error) {
      throw pluginError("ARTIFACT_DOWNLOAD_FAILED", undefined, error);
    }
    if (!response.ok || (response.url && !isHttpsUrl(response.url))) {
      throw pluginError("ARTIFACT_DOWNLOAD_FAILED");
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) !== artifact.size) {
      throw pluginError("ARTIFACT_SIZE_MISMATCH");
    }
    const contents = await readArtifactBody(response, artifact.size, this.maxBytes);
    const digest = createHash("sha256").update(contents).digest("hex");
    if (digest !== artifact.sha256) throw pluginError("INTEGRITY_MISMATCH");

    const parent = path.dirname(destination);
    await this.fileSystem.mkdir(parent);
    const tarballPath = path.join(parent, "artifact.tgz");
    try {
      await this.fileSystem.writeFile(tarballPath, contents);
      await inspectArtifact(tarballPath, this.archiveLimits);
      await this.fileSystem.mkdir(destination);
      const extraction: { unpack?: tar.Unpack } = {};
      const validator = createArchiveFilter(this.archiveLimits, (error) => {
        queueMicrotask(() => extraction.unpack?.abort(error));
      });
      const unpack = new tar.Unpack({
        cwd: destination,
        strip: 1,
        preservePaths: false,
        strict: true,
        maxMetaEntrySize: Math.min(this.archiveLimits.maxFileBytes, this.archiveLimits.maxExpandedBytes),
        filter: validator.filter,
      });
      extraction.unpack = unpack;
      unpack.on("meta", (contents: string) => validator.acceptMetadata(contents));
      await pipeTarball(tarballPath, unpack, "close");
      validator.assertAccepted();
      // Recheck logical sizes after extraction so sparse files cannot bypass header accounting.
      await inspectExtractedTree(this.fileSystem, destination, this.archiveLimits);
    } catch (error) {
      await this.fileSystem.rm(destination).catch(() => undefined);
      if (error instanceof Error && "code" in error && error.code === "UNSAFE_ARCHIVE") throw error;
      throw pluginError("UNSAFE_ARCHIVE", undefined, error);
    } finally {
      await this.fileSystem.rm(tarballPath).catch(() => undefined);
    }
  }
}
