export interface MissionMergeConflict {
  taskId: string;
  baseBranch: string;
  conflictFiles: string[];
}

export interface MissionMergeConflictDelivery {
  idempotencyKey: string;
  message: string;
  deduped: boolean;
}

type FetchTerminalInput = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildMissionMergeConflictFeedback({
  taskId,
  baseBranch,
  conflictFiles,
}: MissionMergeConflict): Omit<MissionMergeConflictDelivery, "deduped"> {
  const files = [...new Set(conflictFiles)].sort();
  const fingerprint = stableHash([baseBranch, ...files].join("\0"));
  const fileList = files.length > 0
    ? files.map((file) => `- ${file}`).join("\n")
    : "- (Tower could not identify the conflicting files)";

  return {
    idempotencyKey: `missions-merge-conflict:${taskId}:${fingerprint}`,
    message: [
      "Tower could not complete this task because the task branch conflicts with the target base branch.",
      "",
      `Target base branch: ${baseBranch}`,
      "Conflict files:",
      fileList,
      "",
      `In the current worktree, run \`git merge ${baseBranch}\`, resolve every conflict, stage the resolutions, and commit them.`,
      "Do not resolve the conflict in the main repository.",
      "After committing the resolution, wait for the user to click Complete again.",
    ].join("\n"),
  };
}

export async function submitMissionMergeConflictFeedback({
  conflict,
  submittedKeys,
  fetchTerminalInput = fetch,
}: {
  conflict: MissionMergeConflict;
  submittedKeys: Set<string>;
  fetchTerminalInput?: FetchTerminalInput;
}): Promise<MissionMergeConflictDelivery> {
  const feedback = buildMissionMergeConflictFeedback(conflict);
  if (submittedKeys.has(feedback.idempotencyKey)) {
    return { ...feedback, deduped: true };
  }

  // Claim locally before awaiting fetch so duplicate callbacks from the same
  // response cannot race. The terminal route independently claims the same key
  // on the PTY session, covering retries across renders or component instances.
  submittedKeys.add(feedback.idempotencyKey);
  try {
    const response = await fetchTerminalInput(
      `/api/internal/terminal/${conflict.taskId}/input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: feedback.message,
          submit: true,
          idempotencyKey: feedback.idempotencyKey,
        }),
      },
    );

    const data = await response.json().catch(() => ({}));
    if (response.status === 409 && data.inProgress === true) {
      return { ...feedback, deduped: true };
    }
    if (!response.ok) {
      throw new Error(data.error ?? `Terminal input failed (${response.status})`);
    }
    return { ...feedback, deduped: data.deduped === true };
  } catch (error) {
    submittedKeys.delete(feedback.idempotencyKey);
    throw error;
  }
}
