import { describe, it, expect, vi, beforeEach } from "vitest";

describe("stream route - send-back flow", () => {
  it.todo("transitions IN_REVIEW task to IN_PROGRESS before creating execution");
  it.todo("does NOT transition task if status is not IN_REVIEW");
  it.todo("creates a new TaskExecution record for send-back");
});
