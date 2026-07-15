import os from "os";
import path from "path";

export function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export interface GitPathRule {
  id: string;
  host: string;
  ownerMatch: string;        // exact owner, or "*" for any
  localPathTemplate: string; // supports {owner}; {repo} auto-appended
  priority: number;          // lower number = higher priority
}

/**
 * Match a git URL against a list of GitPathRule entries.
 * Rules are sorted by priority (lower = higher priority).
 * First matching rule returns the interpolated localPathTemplate.
 * Returns "" if no rule matches.
 */
export function matchGitPathRule(url: string, rules: GitPathRule[]): string {
  if (!rules.length) return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  const parsed = parseGitUrl(trimmed);
  if (!parsed) return "";

  const { host, pathSegments } = parsed;
  const owner = pathSegments[0] ?? "";
  const repo = pathSegments[pathSegments.length - 1] ?? "";

  // Exact owner matches take priority over wildcard (*), regardless of priority number
  const sorted = [...rules].sort((a, b) => {
    const aExact = a.ownerMatch !== "*" ? 0 : 1;
    const bExact = b.ownerMatch !== "*" ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return a.priority - b.priority;
  });

  // Full path = all segments joined (e.g. "EBG_jcjf/jiangsu/NJZSBM/enrollment-static")
  const fullPath = pathSegments.join("/");

  for (const rule of sorted) {
    if (rule.host !== host) continue;
    if (rule.ownerMatch !== "*" && rule.ownerMatch !== owner) continue;

    const tpl = rule.localPathTemplate;

    // If template contains {path}, replace with full path (preserves subgroup structure)
    if (tpl.includes("{path}")) {
      const result = tpl
        .replace("{path}", fullPath)
        .replace("{owner}", owner)
        .replace("{repo}", repo)
        .replace(/\/+$/, "");
      return expandHome(result);
    }

    // Default: auto-append repo name to base path
    const base = tpl
      .replace("{owner}", owner)
      .replace("{repo}", "")
      .replace(/\/+$/, "");
    return expandHome(`${base}/${repo}`);
  }
  return "";
}

/**
 * Git URL → Local Path mapping fallback.
 *
 * Organization/company-specific path rules belong in `git.pathMappingRules`.
 * Built-in fallback only keeps generic GitHub conventions and otherwise uses
 * `~/project/f/{repo}`.
 */

const GITHUB_USERNAME = "jp-liu";

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
 *   https://github.com/user/repo (no .git)
 *     → https://github.com/user/repo.git
 *
 * Already valid clone URLs are returned as-is:
 *   git@github.com:user/repo.git
 *   ssh://git@example.com:30004/path.git
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
    const rawPath = decodeURIComponent(urlObj.pathname);
    let segments = rawPath.split("/").filter(Boolean);

    // Some GitLab-like deployments expose browser URLs under wrappers such as
    // /osc/_source/<path>/-/code. Treat these as URL-shape conventions, not as
    // company/domain-specific rules.
    if (segments[0] === "osc" && segments[1] === "_source") {
      segments = segments.slice(2);
    }
    const dashIdx = segments.indexOf("-");
    if (dashIdx > 0) {
      segments = segments.slice(0, dashIdx);
    }
    if (segments.length === 0) return trimmed;

    return `${urlObj.origin}/${segments.join("/")}.git`;
  } catch {
    return trimmed;
  }
}

// ─── Internal ────────────────────────────────────────────────────────

export interface ParsedUrl {
  host: string;
  pathSegments: string[];
}

export function parseGitUrl(raw: string): ParsedUrl | null {
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
    // ssh://git@example.com:30004/path → need to handle port in URL
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
