import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const WORKTREE_SEGMENT = ".worktrees";

/**
 * Derive a stable logical identifier for an uploaded source file.
 *
 * The auto-upload hook fires once per Write/Edit/MultiEdit, so the SAME file is
 * uploaded many times during one task. Keying assets by this stable identifier
 * (instead of by basename + a fresh `Date.now()` suffix) lets repeated uploads
 * collapse onto a single asset record.
 *
 * Rules:
 * - Files inside `<projectRoot>/.worktrees/<wt>/...` are keyed by their path
 *   relative to the worktree root (the `.worktrees/<wt>/` prefix is stripped),
 *   so a worktree run and a non-worktree run of the same logical file map to
 *   the same key.
 * - Other files under the project root are keyed by their project-relative path.
 * - Files outside the project root (e.g. under /tmp) fall back to their basename.
 *
 * Always returns POSIX-separated paths for cross-platform stability.
 */
export function deriveSourceKey(
  filePath: string,
  projectRoot: string | null,
): string {
  const resolved = path.resolve(filePath);
  const toPosix = (p: string) => p.split(path.sep).join("/");

  if (projectRoot) {
    const root = path.resolve(projectRoot);
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      const relPosix = toPosix(path.relative(root, resolved));
      const segs = relPosix.split("/");
      // Strip ".worktrees/<wt>/" → logical path within the worktree.
      if (segs[0] === WORKTREE_SEGMENT && segs.length >= 3) {
        return segs.slice(2).join("/");
      }
      return relPosix;
    }
  }
  // Outside the project (tmp or elsewhere) → basename only.
  return toPosix(path.basename(resolved));
}

/** Deterministic short hash of a string — stable across runs/processes. */
export function shortHash(input: string, len = 8): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, len);
}

/** sha256 hex of a file's content, used to detect unchanged re-uploads. */
export function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Stable on-disk filename for an asset.
 *
 * Uses the source file's basename as-is. When `needsDisambiguation` is set
 * (a *different* source file already occupies that basename on disk), append a
 * deterministic short hash of the sourceKey — NOT a timestamp — so the same
 * logical file always resolves to the same name and can be overwritten in place.
 */
export function buildAssetFilename(
  sourceKey: string,
  ext: string,
  needsDisambiguation: boolean,
): string {
  const base = path.posix.basename(sourceKey);
  if (!needsDisambiguation) return base;
  const suffix = `-${shortHash(sourceKey)}`;
  if (!ext) return `${base}${suffix}`;
  const dotExt = `.${ext}`;
  const stem = base.toLowerCase().endsWith(dotExt.toLowerCase())
    ? base.slice(0, base.length - dotExt.length)
    : base;
  return `${stem}${suffix}${dotExt}`;
}
