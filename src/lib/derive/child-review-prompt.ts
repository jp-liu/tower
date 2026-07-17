/**
 * Derivation hub: the "guidance prompt" written into the [parent task]'s
 * terminal when a sub-task finishes a round.
 *
 * This is a built-in, **read-only** prompt — deliberately a code constant
 * rather than a SystemConfig value: no override channel = truly read-only, the
 * UI only displays it and can't edit it. Used solely for the completion
 * callback: the sub-task's stop hook fires → notify-parent interpolates this
 * and writes it into the parent's PTY to wake the parent up for review.
 *
 * Placeholders: {{childTitle}} / {{childTaskId}} / {{childReply}}
 */

export const CHILD_REVIEW_PROMPT_TEMPLATE = [
  "[Tower] The sub-task \"{{childTitle}}\" (taskId: {{childTaskId}}) you derived just finished a round and is awaiting instructions — it may or may not be done.",
  "",
  "The sub-task's last reply:",
  "{{childReply}}",
  "",
  "Please review as the hub:",
  "1. To verify what it actually changed, **prefer** using git to inspect the commits this sub-task made this round (e.g. `git -C <sub-task worktree> log` / `show` / `diff`) — a commit diff is precise and compact. **Only when the sub-task made no commits this round** should you fall back to `get_task_terminal_output` to read its terminal. Terminal output is large and noisy, eats a lot of context, and clouds your review judgment — so when you can look at commits, don't read the terminal.",
  "2. If correctly completed → stop_task_execution to close it + move_task to DONE.",
  "3. If not done / has problems → send_task_terminal_input to give it specific feedback and let it keep working.",
  "4. If the sub-task ended by **escalating a blocker / decision to you** (its last reply asks you to make a call it can't) → decide it and send_task_terminal_input the decision back so it resumes. If you can't decide either, escalate **upward** — to your own parent if you were derived, otherwise ask_human — but **never bounce the same question straight back down** to the sub-task, or it just spins.",
  "5. Record your judgment and decision with manage_notes, so the user can review it later.",
].join("\n");

export interface ChildReviewVars {
  childTitle: string;
  childTaskId: string;
  childReply: string;
}

/** Interpolate sub-task info into the final text written to the parent's PTY. */
export function buildChildReviewPrompt(vars: ChildReviewVars): string {
  return CHILD_REVIEW_PROMPT_TEMPLATE.replaceAll("{{childTitle}}", vars.childTitle)
    .replaceAll("{{childTaskId}}", vars.childTaskId)
    .replaceAll("{{childReply}}", vars.childReply.trim() || "(no text reply)");
}
