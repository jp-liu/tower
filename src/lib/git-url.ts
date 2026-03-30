import os from "os";
import path from "path";

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Git URL → Local Path mapping (hardcoded rules for now, will extract to config later)
 *
 * Rules:
 *   code.iflytek.com  → ~/company/{org/path/repo}
 *   github.com/jp-liu → ~/project/i/{repo}
 *   github.com/other  → ~/project/f/{repo}
 */

const GITHUB_USERNAME = "jp-liu";
const COMPANY_HOST = "code.iflytek.com";

/**
 * Parse a git URL and return the suggested local path.
 * Returns empty string if the URL is not recognized.
 */
export function gitUrlToLocalPath(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  try {
    // Normalize: extract host and path from various URL formats
    const parsed = parseGitUrl(trimmed);
    if (!parsed) return "";

    const { host, pathSegments } = parsed;

    if (host === COMPANY_HOST) {
      return expandHome(companyPath(pathSegments));
    }

    if (host === "github.com") {
      return expandHome(githubPath(pathSegments));
    }

    // Unknown host — fallback: ~/project/f/{repo}
    const repo = pathSegments[pathSegments.length - 1];
    return repo ? expandHome(`~/project/f/${repo}`) : "";
  } catch {
    return "";
  }
}

/**
 * Normalize any git-related URL into a valid clone URL.
 *
 * Browser URLs (not clonable) are converted to HTTPS clone URLs:
 *   https://code.iflytek.com/osc/_source/EBG_jcjf/.../repo/-/code/
 *     → https://code.iflytek.com/EBG_jcjf/.../repo.git
 *   https://github.com/user/repo (no .git)
 *     → https://github.com/user/repo.git
 *
 * Already valid clone URLs are returned as-is:
 *   git@github.com:user/repo.git
 *   ssh://git@code.iflytek.com:30004/path.git
 *   https://github.com/user/repo.git
 */
export function toCloneUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  // SSH shorthand — already a valid clone URL
  if (trimmed.startsWith("git@")) return trimmed;

  // ssh:// — already a valid clone URL
  if (trimmed.startsWith("ssh://")) return trimmed;

  // If it ends with .git, assume it's already a clone URL
  if (trimmed.endsWith(".git")) return trimmed;

  try {
    const urlObj = new URL(trimmed);
    const host = urlObj.hostname;
    const rawPath = decodeURIComponent(urlObj.pathname);
    const segments = rawPath.split("/").filter(Boolean);

    if (host === COMPANY_HOST) {
      // Strip GitLab prefixes: osc/_source
      let parts = [...segments];
      if (parts[0] === "osc" && parts[1] === "_source") {
        parts = parts.slice(2);
      }
      // Strip GitLab suffixes: /-/code, /-/tree/branch, /-/blob/...
      const dashIdx = parts.indexOf("-");
      if (dashIdx > 0) {
        parts = parts.slice(0, dashIdx);
      }
      if (parts.length === 0) return trimmed;
      return `https://${host}/${parts.join("/")}.git`;
    }

    // GitHub / other — just append .git
    return `${urlObj.origin}${urlObj.pathname.replace(/\/$/, "")}.git`;
  } catch {
    return trimmed;
  }
}

// ─── Internal ────────────────────────────────────────────────────────

interface ParsedUrl {
  host: string;
  pathSegments: string[];
}

function parseGitUrl(raw: string): ParsedUrl | null {
  // SSH shorthand: git@github.com:owner/repo.git
  const sshShort = raw.match(/^git@([^:]+):(.+)$/);
  if (sshShort) {
    const host = sshShort[1];
    const path = stripGitSuffix(sshShort[2]);
    return { host, pathSegments: path.split("/").filter(Boolean) };
  }

  // ssh://git@host:port/path or https://host/path
  let urlObj: URL;
  try {
    // ssh://git@code.iflytek.com:30004/path → need to handle port in URL
    urlObj = new URL(raw);
  } catch {
    return null;
  }

  const host = urlObj.hostname;
  const rawPath = stripGitSuffix(decodeURIComponent(urlObj.pathname));
  const segments = rawPath.split("/").filter(Boolean);

  return { host, pathSegments: segments };
}

function stripGitSuffix(p: string): string {
  return p.replace(/\.git\/?$/, "");
}

/**
 * code.iflytek.com paths:
 *   /osc/_source/EBG_jcjf/jiangsu/NJZSBM/enrollment-static/-/code/
 *   /EBG_jcjf/jiangsu/NJZSBM/enrollment-static
 *
 * Strip known prefixes (osc/_source) and suffixes (/-/code, /-/tree, etc.)
 * Result: ~/company/EBG_jcjf/jiangsu/NJZSBM/enrollment-static
 */
function companyPath(segments: string[]): string {
  let parts = [...segments];

  // Strip leading "osc/_source" or similar prefixes
  if (parts[0] === "osc" && parts[1] === "_source") {
    parts = parts.slice(2);
  }

  // Strip trailing gitlab-like suffixes: /-/code, /-/tree/branch, etc.
  const dashIdx = parts.indexOf("-");
  if (dashIdx > 0) {
    parts = parts.slice(0, dashIdx);
  }

  if (parts.length === 0) return "";
  return `~/company/${parts.join("/")}`;
}

/**
 * github.com paths:
 *   /jp-liu/inkos   → ~/project/i/inkos
 *   /other/opencli  → ~/project/f/opencli
 */
function githubPath(segments: string[]): string {
  // segments: [owner, repo, ...]
  const owner = segments[0];
  const repo = segments[1];
  if (!owner || !repo) return "";

  const prefix = owner === GITHUB_USERNAME ? "~/project/i" : "~/project/f";
  return `${prefix}/${repo}`;
}
