/**
 * Migrate legacy Tower MCP entries that earlier versions of this app wrote
 * directly into ~/.claude/settings.json under `mcpServers.tower`.
 *
 * Why this exists:
 *   - Claude CLI 4.x reads user-scope MCP servers from ~/.claude.json (NOT
 *     ~/.claude/settings.json). The old code wrote to the wrong file, so the
 *     CLI never picked the entry up — and worse, after the user moved/renamed
 *     the project directory, the stale entry pointed at a path that no longer
 *     exists. That manifested as the `tower · failed` row in `/mcp`.
 *   - The CLI has no `claude mcp remove` for entries in settings.json (it only
 *     touches its own scopes). So we have to delete the legacy key directly.
 *
 * Run this once per provider before re-installing via the CLI, in the test-
 * connection success path. Idempotent.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface MigrationStep {
  /** True iff a stale entry was found and removed. */
  removed: boolean;
  /** The file we touched. */
  path: string;
  /** The old entry contents, for logging. */
  removedEntry?: Record<string, unknown>;
  /** Why we decided to remove (e.g. "wrong-file" / "stale-path"). */
  reason?: string;
  error?: string;
}

export interface MigrationReport {
  steps: MigrationStep[];
  /** True iff at least one step removed something. */
  removedAny: boolean;
}

export interface MigrationOptions {
  /** Override $HOME — only used by tests. Defaults to os.homedir(). */
  homeDir?: string;
  /** Override repo root — only used by tests. Defaults to process.cwd(). */
  repoRoot?: string;
}

/**
 * Run all known legacy-cleanup steps. Idempotent.
 *
 * Two stale shapes get cleaned up here:
 *   1. ~/.claude/settings.json → mcpServers.tower
 *      Earlier Tower versions wrote here, but Claude CLI 4.x reads user-scope
 *      from ~/.claude.json — so this entry never worked.
 *   2. ~/.mcp.json → mcpServers.tower (project scope when claude runs from $HOME)
 *      Earlier Tower init ran with cwd=$HOME and `claude mcp add -s project`
 *      landed an entry there. Project scope OVERRIDES user scope, so a stale
 *      copy here masks the new (correct) user-scope entry. We only remove if
 *      the entry doesn't point into the current repo.
 */
export function migrateLegacyTowerMcp(opts: MigrationOptions = {}): MigrationReport {
  const homeDir = opts.homeDir ?? os.homedir();
  const repoRoot = opts.repoRoot ?? process.cwd();
  const steps: MigrationStep[] = [];
  steps.push(removeFromClaudeSettingsJson(homeDir));
  steps.push(removeStaleTowerFromMcpJson(path.join(homeDir, ".mcp.json"), "home-mcp-json", repoRoot));
  return {
    steps,
    removedAny: steps.some((s) => s.removed),
  };
}

/**
 * Step 1: ~/.claude/settings.json — remove `mcpServers.tower` unconditionally.
 * Claude CLI 4.x ignores `mcpServers` here entirely, so the entry is dead weight.
 */
function removeFromClaudeSettingsJson(homeDir: string): MigrationStep {
  const settingsPath = path.join(homeDir, ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) {
    return { removed: false, path: settingsPath };
  }

  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers = data["mcpServers"];
    if (
      typeof mcpServers !== "object" ||
      mcpServers === null ||
      Array.isArray(mcpServers) ||
      !("tower" in (mcpServers as Record<string, unknown>))
    ) {
      return { removed: false, path: settingsPath };
    }

    const servers = mcpServers as Record<string, unknown>;
    const removed = servers["tower"] as Record<string, unknown> | undefined;
    delete servers["tower"];

    if (Object.keys(servers).length === 0) {
      delete data["mcpServers"];
    } else {
      data["mcpServers"] = servers;
    }

    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    return {
      removed: true,
      path: settingsPath,
      removedEntry: removed,
      reason: "wrong-file",
    };
  } catch (err) {
    return {
      removed: false,
      path: settingsPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Step 2: a project-scope .mcp.json — remove `mcpServers.tower` if it's a
 * Tower-owned entry that does NOT point at the current repo. Two cases:
 *
 *   a) The script path no longer exists on disk → unambiguously stale.
 *   b) The script path still exists but is OUTSIDE the current repo →
 *      almost certainly written by a previous Tower install (different repo
 *      location). Project scope overrides user scope, so leaving it would
 *      mask the freshly-installed user-scope entry. We replace it.
 *
 * We only apply this to .mcp.json files we expect Tower to own (currently
 * just $HOME/.mcp.json) — never to a user's project .mcp.json.
 */
function removeStaleTowerFromMcpJson(filePath: string, reasonTag: string, repoRoot: string): MigrationStep {
  if (!fs.existsSync(filePath)) {
    return { removed: false, path: filePath };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const mcpServers = data["mcpServers"];
    if (
      typeof mcpServers !== "object" ||
      mcpServers === null ||
      Array.isArray(mcpServers)
    ) {
      return { removed: false, path: filePath };
    }
    const servers = mcpServers as Record<string, unknown>;
    const entry = servers["tower"] as Record<string, unknown> | undefined;
    if (!entry) return { removed: false, path: filePath };

    const verdict = classifyEntry(entry, repoRoot);
    if (verdict === "current-repo") {
      return { removed: false, path: filePath, reason: "alive-current-repo" };
    }

    delete servers["tower"];
    if (Object.keys(servers).length === 0) {
      delete data["mcpServers"];
    } else {
      data["mcpServers"] = servers;
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    return {
      removed: true,
      path: filePath,
      removedEntry: entry,
      reason: `${reasonTag}:${verdict}`,
    };
  } catch (err) {
    return {
      removed: false,
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

type EntryVerdict =
  | "current-repo"   // points into the running repo — leave alone
  | "missing-path"   // command target file does not exist
  | "foreign-repo";  // exists but lives outside the running repo (different install)

function classifyEntry(entry: Record<string, unknown>, repoRoot: string): EntryVerdict {
  const args = entry["args"];
  if (!Array.isArray(args)) return "foreign-repo";

  // Find the first absolute path in args; that's almost always the entrypoint.
  let scriptPath: string | undefined;
  for (const a of args) {
    if (typeof a === "string" && path.isAbsolute(a)) {
      scriptPath = a;
      break;
    }
  }
  if (!scriptPath) return "foreign-repo";

  if (!fs.existsSync(scriptPath)) return "missing-path";

  const inRepo = path.resolve(scriptPath).startsWith(path.resolve(repoRoot) + path.sep);
  return inRepo ? "current-repo" : "foreign-repo";
}
