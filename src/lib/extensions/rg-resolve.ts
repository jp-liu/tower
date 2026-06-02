import { existsSync } from "fs";

/**
 * Resolve the bundled ripgrep binary shipped via `@vscode/ripgrep`.
 *
 * `@vscode/ripgrep` ships the actual `rg` binary as a per-platform npm
 * optionalDependency (`@vscode/ripgrep-<os>-<arch>`), so it installs from the
 * configured registry (CN mirror-friendly) without hitting GitHub. Bundling
 * means code search works out of the box — the user doesn't have to install
 * ripgrep themselves.
 *
 * Returns `null` (rather than throwing) when the package or the platform
 * binary is absent — e.g. a build where the native was pruned and the
 * optionalDependency didn't reinstall — so callers can fall back to a
 * system-installed `rg` on PATH.
 */
export async function resolveBundledRgPath(): Promise<string | null> {
  try {
    const { rgPath } = await import("@vscode/ripgrep");
    if (rgPath && existsSync(rgPath)) return rgPath;
  } catch {
    // package not installed / platform binary missing — fall through to system
  }
  return null;
}
