import { execSync } from "child_process";

export interface DiffFile {
  filename: string;
  added: number;
  removed: number;
  isBinary: boolean;
  patch: string; // unified diff content for this file
}

export interface DiffResponse {
  files: DiffFile[];
  totalAdded: number;
  totalRemoved: number;
  hasConflicts: boolean;
  conflictFiles: string[];
}

/**
 * Parse git diff --numstat and git diff --unified=3 output into structured DiffFile array.
 * Returns data without hasConflicts/conflictFiles (those are added by the caller).
 */
export function parseDiffOutput(
  numstat: string,
  unifiedDiff: string
): Omit<DiffResponse, "hasConflicts" | "conflictFiles"> {
  // Parse numstat: each line is `{added}\t{removed}\t{filename}`
  // Binary files have `-\t-\t{filename}`
  const numstatEntries: Array<{
    filename: string;
    added: number;
    removed: number;
    isBinary: boolean;
  }> = [];

  for (const line of numstat.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("\t");
    if (parts.length < 3) continue;
    const [addedStr, removedStr, ...filenameParts] = parts;
    const filename = filenameParts.join("\t");
    if (addedStr === "-" && removedStr === "-") {
      numstatEntries.push({ filename, added: 0, removed: 0, isBinary: true });
    } else {
      numstatEntries.push({
        filename,
        added: parseInt(addedStr, 10) || 0,
        removed: parseInt(removedStr, 10) || 0,
        isBinary: false,
      });
    }
  }

  // Parse unified diff: split on lines matching `^diff --git a/.+ b/.+`
  const DIFF_GIT_HEADER = /^diff --git a\/.+ b\/.+$/m;
  const diffHeaderRegex = /^diff --git a\/(.+) b\/(.+)$/;

  // Split into segments per file
  const patchMap = new Map<string, string>();

  if (unifiedDiff.trim()) {
    const isTruncationNeeded = unifiedDiff.length > 500 * 1024; // 500KB

    // Split at each diff --git header line
    const segments = unifiedDiff.split(/(?=^diff --git )/m);
    for (const segment of segments) {
      if (!segment.trim()) continue;
      const firstLine = segment.split("\n")[0];
      const match = diffHeaderRegex.exec(firstLine);
      if (!match) continue;
      const filename = match[2]; // Use b/ filename

      let patch = segment;
      if (isTruncationNeeded) {
        const lines = segment.split("\n");
        if (lines.length > 200) {
          patch = lines.slice(0, 200).join("\n") + "\n... (truncated)";
        }
      }
      patchMap.set(filename, patch);
    }
  }

  // Match numstat entries to unified diff segments by filename
  const files: DiffFile[] = numstatEntries.map((entry) => ({
    filename: entry.filename,
    added: entry.added,
    removed: entry.removed,
    isBinary: entry.isBinary,
    patch: patchMap.get(entry.filename) ?? "",
  }));

  const totalAdded = files.reduce((sum, f) => sum + f.added, 0);
  const totalRemoved = files.reduce((sum, f) => sum + f.removed, 0);

  return { files, totalAdded, totalRemoved };
}

/**
 * Check if merging worktreeBranch into baseBranch would produce conflicts.
 * Uses `git merge-tree --write-tree` for a dry-run conflict check.
 */
export function checkConflicts(
  localPath: string,
  baseBranch: string,
  worktreeBranch: string
): { hasConflicts: boolean; conflictFiles: string[] } {
  try {
    execSync(
      `git merge-tree --write-tree ${baseBranch} ${worktreeBranch}`,
      { cwd: localPath, encoding: "utf-8", timeout: 10000, stdio: "pipe" }
    );
    return { hasConflicts: false, conflictFiles: [] };
  } catch (err: unknown) {
    // Exit code 1 means conflicts exist — parse stdout for CONFLICT lines
    const output =
      err instanceof Error && "stdout" in err
        ? String((err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? "")
        : "";
    const conflictFiles = output
      .split("\n")
      .filter((line) => line.includes("CONFLICT"))
      .map((line) => {
        // Lines look like: "CONFLICT (content): Merge conflict in path/to/file"
        const match = line.match(/CONFLICT.*?:\s*(.+)$/);
        return match ? match[1].trim() : line.trim();
      })
      .filter(Boolean);
    return { hasConflicts: true, conflictFiles };
  }
}
