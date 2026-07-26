import { createHash } from "node:crypto";
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

async function inspectArtifact(tarballPath: string): Promise<void> {
  let rejected: unknown;
  try {
    await tar.t({
      file: tarballPath,
      filter(entryPath, entry) {
        try {
          assertSafeArtifactPath(entryPath);
          if (!("type" in entry)
            || (entry.type !== "File" && entry.type !== "Directory" && entry.type !== "OldFile")) {
            throw pluginError("UNSAFE_ARCHIVE");
          }
          return true;
        } catch (error) {
          rejected ??= error;
          return false;
        }
      },
    });
    if (rejected) throw rejected;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "UNSAFE_ARCHIVE") throw error;
    throw pluginError("UNSAFE_ARCHIVE", undefined, error);
  }
}

export interface PrebuiltArtifactProviderOptions {
  fetchImpl?: CatalogFetch;
  fileSystem?: PluginFileSystem;
  maxBytes?: number;
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

  constructor(options: PrebuiltArtifactProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.fileSystem = options.fileSystem ?? new NodePluginFileSystem();
    this.maxBytes = options.maxBytes ?? MAX_EXTENSION_ARTIFACT_BYTES;
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
    await this.fileSystem.writeFile(tarballPath, contents);
    await inspectArtifact(tarballPath);
    await this.fileSystem.mkdir(destination);
    try {
      let rejected: unknown;
      await tar.x({
        file: tarballPath,
        cwd: destination,
        strip: 1,
        preservePaths: false,
        strict: true,
        filter(entryPath, entry) {
          try {
            assertSafeArtifactPath(entryPath);
            if (!("type" in entry)
              || (entry.type !== "File" && entry.type !== "Directory" && entry.type !== "OldFile")) {
              throw pluginError("UNSAFE_ARCHIVE");
            }
            return true;
          } catch (error) {
            rejected ??= error;
            return false;
          }
        },
      });
      if (rejected) throw rejected;
    } catch (error) {
      await this.fileSystem.rm(destination).catch(() => undefined);
      if (error instanceof Error && "code" in error && error.code === "UNSAFE_ARCHIVE") throw error;
      throw pluginError("UNSAFE_ARCHIVE", undefined, error);
    }
  }
}
