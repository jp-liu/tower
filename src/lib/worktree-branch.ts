/**
 * Worktree branch naming: which branch a task's worktree gets.
 *
 * The prefix lives on the Label (`Label.branchPrefix`), so a task carrying a
 * prefixed label branches as `<prefix>/<taskId>`. Anything else falls back to
 * the `git.defaultWorktreeBranchPrefix` config, whose "task" default reproduces
 * the historical `task/<taskId>` exactly. The worktree DIRECTORY name never
 * changes — it stays `.worktrees/task-<taskId>`.
 *
 * The resolved name is persisted on `TaskExecution.worktreeBranch` at creation
 * time. Teardown paths must read it back from there (see
 * `getRecordedWorktreeBranch` in task-completion.ts) rather than re-deriving it:
 * a label's prefix can change mid-flight, and a re-derived name would point at
 * a branch that never existed.
 *
 * Kept free of db/config imports so the settings UI can share the validation.
 */

/** Just the field the resolver needs — any Label-shaped row satisfies it. */
export interface BranchPrefixLabel {
  branchPrefix?: string | null;
}

/** Fallback when the configured default is missing/unusable — historical behavior. */
export const DEFAULT_BRANCH_PREFIX = "task";

/** Leading char excludes `-` and `.`, which git rejects at the start of a ref. */
const PREFIX_RE = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

/** True if `prefix` is usable as the leading segment(s) of a git branch name. */
export function isValidBranchPrefix(prefix: string): boolean {
  return (
    PREFIX_RE.test(prefix) &&
    !prefix.includes("..") &&
    !prefix.includes("//") &&
    !prefix.endsWith("/")
  );
}

/**
 * The branch name for a task's worktree: `<prefix>/<taskId>`, taking the prefix
 * from the first label that carries one. A task may hold several labels (the
 * board allows multi-select), so callers pass them in a stable order — first
 * prefixed label wins.
 *
 * Falls back to `defaultPrefix` when no label has one. Invalid prefixes are
 * skipped rather than thrown on: the settings UI rejects them on save, so one
 * reaching here means a hand-edited DB, and falling back beats failing the
 * whole execution start.
 */
export function resolveWorktreeBranch(
  labels: BranchPrefixLabel[],
  defaultPrefix: string,
  taskId: string
): string {
  const hit = labels.find(
    (label) => label.branchPrefix && isValidBranchPrefix(label.branchPrefix)
  );
  const fallback = isValidBranchPrefix(defaultPrefix)
    ? defaultPrefix
    : DEFAULT_BRANCH_PREFIX;
  return `${hit?.branchPrefix ?? fallback}/${taskId}`;
}
