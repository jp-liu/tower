import path from "path";

/**
 * Validates that `relative` resolves to a path within `base`.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 * Per D-02: used by all file operation server actions in Phase 20 and Phase 21 editor.
 *
 * @param base - Absolute base directory (the worktree root)
 * @param relative - Relative path provided by client
 * @returns Resolved absolute path guaranteed to be within base
 * @throws Error if path escapes the base directory
 */
export function safeResolvePath(base: string, relative: string): string {
  // Normalize base to remove trailing separator for consistent comparison
  const normalizedBase = base.endsWith(path.sep) ? base.slice(0, -1) : base;
  const resolved = path.resolve(normalizedBase, relative);
  // Allow exact match (relative = "." resolves to base itself)
  if (resolved !== normalizedBase && !resolved.startsWith(normalizedBase + path.sep)) {
    throw new Error(`Path traversal attempt: ${relative}`);
  }
  return resolved;
}
