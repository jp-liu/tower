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
  // Normalize Windows backslashes first — otherwise the forward-slash regex
  // never matches a Windows asset path (C:\...\storage\assets\...) and every
  // asset preview on Windows breaks.
  const normalized = src.replace(/\\/g, "/");
  // Match assets/{projectId}/{filename} under any storage root: the canonical
  // `storage/assets/...`, the legacy `data/assets/...`, or a relocated root —
  // we anchor on the `/assets/<projectId>/<filename>` tail, which is stable
  // regardless of where the storage directory lives.
  const match = normalized.match(/\/assets\/([^/]+)\/([^/]+)$/);
  if (match) {
    return `/api/files/assets/${match[1]}/${match[2]}`;
  }
  return src;
}
