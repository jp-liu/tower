/**
 * Browser-safe utility for converting local asset paths to API URLs.
 * No Node.js dependencies — safe to import from "use client" components.
 */
export function localPathToApiUrl(src: string): string {
  // Match data/assets/{projectId}/{filename} or /data/assets/{projectId}/{filename}
  const match = src.match(/(?:^|\/)data\/assets\/([^/]+)\/([^/]+)$/);
  if (match) {
    return `/api/files/assets/${match[1]}/${match[2]}`;
  }
  return src;
}
