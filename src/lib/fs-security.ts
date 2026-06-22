import path from "path";

// Minimal slice of the `path` API this module relies on. Accepting it as a
// parameter lets tests exercise the win32 logic on a POSIX host (and vice
// versa) by passing `path.win32` / `path.posix`.
type PathLike = Pick<
  typeof path,
  "resolve" | "relative" | "isAbsolute" | "sep"
>;

/**
 * Validates that `relative` resolves to a path within `base`.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 * Per D-02: used by all file operation server actions in Phase 20 and Phase 21 editor.
 *
 * @param base - Absolute base directory (the worktree root)
 * @param relative - Relative path provided by client
 * @param impl - Path implementation (defaults to the platform `path`); injectable for tests
 * @returns Resolved absolute path guaranteed to be within base
 * @throws Error if path escapes the base directory
 */
export function safeResolvePath(
  base: string,
  relative: string,
  impl: PathLike = path
): string {
  // Fully normalize both ends through path.resolve so the comparison is robust
  // across platforms. On Windows a raw `startsWith` check breaks when `base`
  // mixes separators (e.g. "D:/repo/.worktrees/x") while path.resolve emits
  // backslashes, or when drive-letter casing differs — both yielded false
  // "Path traversal attempt" errors. path.relative handles separator and
  // (on win32) case normalization for us.
  const resolvedBase = impl.resolve(base);
  const resolved = impl.resolve(resolvedBase, relative);

  const rel = impl.relative(resolvedBase, resolved);
  // rel === ""        → resolved === base (allowed; e.g. relative = ".")
  // rel === ".." or starts with "../" → escapes the base directory
  // path.isAbsolute(rel) → different drive on Windows → escapes the base
  const escapes =
    rel === ".." ||
    rel.startsWith(`..${impl.sep}`) ||
    impl.isAbsolute(rel);
  if (escapes) {
    throw new Error(`Path traversal attempt: ${relative}`);
  }
  return resolved;
}
