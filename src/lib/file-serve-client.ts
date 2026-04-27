/**
 * Browser-safe utility for converting local asset paths to API URLs.
 * No Node.js dependencies — safe to import from "use client" components.
 */
export function localPathToApiUrl(src: string): string {
  // Match assets/{projectId}/{filename} under storage/ (.tower/storage/assets/...)
  // Also supports legacy data/assets/ paths for backward compatibility
  const match = src.match(/(?:^|\/)(?:storage|data)\/assets\/([^/]+)\/([^/]+)$/);
  if (match) {
    return `/api/files/assets/${match[1]}/${match[2]}`;
  }
  return src;
}
