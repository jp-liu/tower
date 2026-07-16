/**
 * Resolve filesystem paths that need to point at the Tower package itself
 * (skills/, scripts/, dist/), independent of `process.cwd()`.
 *
 * In production `tower` runs the Next.js standalone server, which forces
 * `process.cwd()` to `.next/standalone/`. Source assets like `skills/tower/`
 * and `scripts/*.js` live one level up at the package root. The bin entry
 * (`bin/tower.mjs`) exports `TOWER_PACKAGE_ROOT` before launching the server
 * so anything that needs to find those files can read it here instead of
 * blindly using `process.cwd()`.
 */
export function getPackageRoot(): string {
  if (process.env.TOWER_PACKAGE_ROOT) return process.env.TOWER_PACKAGE_ROOT;
  const cwd = process.cwd();
  if (cwd.endsWith("/.next/standalone") || cwd.endsWith("\\.next\\standalone")) {
    return cwd.slice(0, -"/.next/standalone".length);
  }
  return cwd;
}
