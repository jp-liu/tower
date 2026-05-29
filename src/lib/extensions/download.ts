/**
 * Download an npm package tarball straight from the registry and extract it
 * into a target directory. No `npm install`, no `~/.npmrc`, no postinstall
 * scripts — just an HTTP GET + a `tar.x` call.
 *
 * Why bypass npm:
 *   - Avoids the `~/.npmrc` prefix= / registry= / proxy= chaos that hoisted
 *     extension installs out of `~/.tower/extensions/` in 0.2.13–0.2.15.
 *   - Avoids Node refusing to execFile `npm.cmd` on Windows (CVE-2024-27980).
 *   - Avoids running arbitrary `postinstall` scripts from third-party deps.
 *
 * Defaults to npmmirror.com because it's the most reliable registry from
 * mainland China. Callers can override `registry` if they need npmjs.org.
 */

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, rename, stat } from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";

const DEFAULT_REGISTRY = "https://registry.npmmirror.com";

export interface DownloadOptions {
  /** Override the registry. Defaults to npmmirror. */
  registry?: string;
  /** Per-attempt HTTP timeout in ms. Defaults to 60s. */
  timeoutMs?: number;
}

/**
 * Download `<pkg>@<version>` and extract it to `destDir`. The extracted layout
 * matches the published package — i.e. `package.json` and the package's
 * `files` land directly under `destDir`, NOT under `destDir/<pkg>/`.
 *
 * The extraction is atomic: we unpack to a sibling tmp dir first, then
 * `rename` over `destDir`. A failed extraction never leaves a half-populated
 * `destDir` behind.
 */
export async function downloadAndExtract(
  pkg: string,
  version: string,
  destDir: string,
  opts: DownloadOptions = {},
): Promise<void> {
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  // Scoped packages: `@scope/name-1.2.3.tgz` under `<registry>/@scope/name/-/`
  // (the un-scoped basename is everything after the `/`).
  const basename = pkg.startsWith("@") ? pkg.split("/")[1] : pkg;
  const tarballUrl = `${registry}/${pkg}/-/${basename}-${version}.tgz`;

  // Stage into a sibling tmpdir under `destDir`'s parent so the final
  // `rename` is on the same filesystem (cross-fs rename throws EXDEV).
  await mkdir(path.dirname(destDir), { recursive: true });
  const stagingDir = await mkdtemp(path.join(path.dirname(destDir), ".tower-ext-"));
  const tarballPath = path.join(stagingDir, "pkg.tgz");

  try {
    await downloadFile(tarballUrl, tarballPath, opts.timeoutMs ?? 60_000);

    // `tar.x` extracts the package's contents. npm tarballs have a top-level
    // `package/` directory we strip with `strip: 1` so files land at the
    // staging root.
    const extractRoot = path.join(stagingDir, "extracted");
    await mkdir(extractRoot, { recursive: true });
    await tar.x({
      file: tarballPath,
      cwd: extractRoot,
      strip: 1,
    });

    // Sanity check — make sure something actually came out the other end.
    const stats = await stat(extractRoot).catch(() => null);
    if (!stats || !stats.isDirectory()) {
      throw new Error(`Tarball extracted but ${extractRoot} is not a directory`);
    }

    // Atomic swap: nuke any prior install, then rename our fresh tree into place.
    if (existsSync(destDir)) {
      await rm(destDir, { recursive: true, force: true });
    }
    await rename(extractRoot, destDir);
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Stream a URL to disk. Follows redirects (npmmirror sometimes 302s to a
 * different CDN host). Rejects on non-2xx and on socket timeout.
 */
function downloadFile(url: string, destPath: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(destPath);
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      out.close();
      if (err) reject(err);
      else resolve();
    };

    let redirects = 0;
    const MAX_REDIRECTS = 5;

    const get = (target: string) => {
      const req = https.get(target, (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          if (++redirects > MAX_REDIRECTS) {
            settle(new Error(`Too many redirects fetching ${url}`));
            res.resume();
            return;
          }
          res.resume();
          const next = new URL(res.headers.location, target).toString();
          get(next);
          return;
        }
        if (code < 200 || code >= 300) {
          settle(new Error(`HTTP ${code} fetching ${url}`));
          res.resume();
          return;
        }
        pipeline(res, out).then(() => settle()).catch(settle);
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timed out after ${timeoutMs}ms fetching ${url}`));
      });
      req.on("error", settle);
    };

    get(url);
  });
}
