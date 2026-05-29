/**
 * Browser-safe utilities for asset handling.
 * No Node.js dependencies — safe to import from "use client" components.
 */

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "apng",
]);

/**
 * Decide whether an asset is an image. Prefer the stored MIME type, but fall
 * back to the filename extension — assets attached via task references / MCP
 * historically saved with a null mimeType, and would otherwise render as a
 * generic file icon despite being PNGs (see asset-item preview).
 */
export function isImageAsset(filename: string, mimeType?: string | null): boolean {
  if (mimeType?.startsWith("image/")) return true;
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.has(ext) : false;
}

export function localPathToApiUrl(src: string): string {
  // Match assets/{projectId}/{filename} under storage/ (.tower/storage/assets/...)
  // Also supports legacy data/assets/ paths for backward compatibility
  const match = src.match(/(?:^|\/)(?:storage|data)\/assets\/([^/]+)\/([^/]+)$/);
  if (match) {
    return `/api/files/assets/${match[1]}/${match[2]}`;
  }
  return src;
}
