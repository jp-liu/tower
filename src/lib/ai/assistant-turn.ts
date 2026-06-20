/**
 * Decision helpers for the assistant chat turn stream
 * (`/api/internal/assistant/chat`).
 *
 * Extracted as pure functions so the "should a failed resume be surfaced to the
 * user, or silently retried as a fresh session?" logic is unit-testable without
 * spinning up the Claude Agent SDK.
 */

export type ResultOutcome = "success" | "error";

/**
 * Classify an SDK `result` message. The CLI reports failures either via an
 * `error*` subtype (e.g. `error_during_execution`, `error_max_turns`) or the
 * `is_error` flag — treat either as an error.
 */
export function classifyResultOutcome(
  subtype: string | undefined,
  isError: boolean | undefined
): ResultOutcome {
  return subtype?.includes("error") || isError ? "error" : "success";
}

/**
 * Whether an errored turn should be suppressed and retried as a fresh session
 * instead of being shown to the user.
 *
 * A stale resume (the CLI session is gone after a restart / cleared history)
 * surfaces as an error result *before any content streams*. In that window we
 * retry transparently. Once content has streamed, an error is a genuine
 * mid-turn failure — retrying would duplicate output and lose context, so it
 * must be surfaced. A fresh attempt's error is always surfaced.
 */
export function shouldRetryFreshOnResume(opts: {
  isResumeAttempt: boolean;
  outcome: ResultOutcome;
  streamedContent: boolean;
}): boolean {
  return opts.isResumeAttempt && opts.outcome === "error" && !opts.streamedContent;
}

/**
 * Match the CLI's "session no longer exists" errors so a stale UI sessionId can
 * fall back to a fresh session rather than dead-ending the user.
 */
export function isStaleResumeError(message: string): boolean {
  return /no conversation found|no session found|session id/i.test(message);
}
