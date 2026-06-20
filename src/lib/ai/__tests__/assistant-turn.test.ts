import { describe, it, expect } from "vitest";
import {
  classifyResultOutcome,
  shouldRetryFreshOnResume,
  isStaleResumeError,
} from "../assistant-turn";

describe("classifyResultOutcome", () => {
  it("treats an error subtype as an error", () => {
    expect(classifyResultOutcome("error_during_execution", undefined)).toBe("error");
    expect(classifyResultOutcome("error_max_turns", false)).toBe("error");
  });

  it("treats is_error=true as an error regardless of subtype", () => {
    expect(classifyResultOutcome("success", true)).toBe("error");
    expect(classifyResultOutcome(undefined, true)).toBe("error");
  });

  it("treats a clean success as success", () => {
    expect(classifyResultOutcome("success", false)).toBe("success");
    expect(classifyResultOutcome(undefined, undefined)).toBe("success");
  });
});

describe("shouldRetryFreshOnResume", () => {
  it("retries when a resume attempt errors before streaming anything (stale session)", () => {
    expect(
      shouldRetryFreshOnResume({ isResumeAttempt: true, outcome: "error", streamedContent: false })
    ).toBe(true);
  });

  it("does NOT retry when content already streamed — that is a genuine mid-turn error", () => {
    expect(
      shouldRetryFreshOnResume({ isResumeAttempt: true, outcome: "error", streamedContent: true })
    ).toBe(false);
  });

  it("does NOT retry a fresh attempt's error — the user must see it", () => {
    expect(
      shouldRetryFreshOnResume({ isResumeAttempt: false, outcome: "error", streamedContent: false })
    ).toBe(false);
  });

  it("does NOT retry a successful resume", () => {
    expect(
      shouldRetryFreshOnResume({ isResumeAttempt: true, outcome: "success", streamedContent: false })
    ).toBe(false);
  });
});

describe("isStaleResumeError", () => {
  it("matches the CLI's missing-session messages", () => {
    expect(isStaleResumeError("No conversation found with session ID 0704ed7d-1234")).toBe(true);
    expect(isStaleResumeError("no session found")).toBe(true);
    expect(isStaleResumeError("invalid session id")).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isStaleResumeError("ENOENT: spawn claude")).toBe(false);
    expect(isStaleResumeError("output token maximum exceeded")).toBe(false);
  });
});
