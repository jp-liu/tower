import { describe, expect, it } from "vitest";

import {
  isValidBranchPrefix,
  resolveWorktreeBranch,
  DEFAULT_BRANCH_PREFIX,
  type BranchPrefixLabel,
} from "@/lib/worktree-branch";

const TASK_ID = "cworktreebranch000000001";
const label = (branchPrefix: string | null): BranchPrefixLabel => ({ branchPrefix });

describe("resolveWorktreeBranch", () => {
  it("falls back to the default prefix when the task has no labels", () => {
    expect(resolveWorktreeBranch([], DEFAULT_BRANCH_PREFIX, TASK_ID)).toBe(`task/${TASK_ID}`);
  });

  it("falls back when the task's labels carry no prefix", () => {
    const labels = [label(null), label("")];
    expect(resolveWorktreeBranch(labels, DEFAULT_BRANCH_PREFIX, TASK_ID)).toBe(`task/${TASK_ID}`);
  });

  it("uses <prefix>/<taskId> from a prefixed label", () => {
    expect(resolveWorktreeBranch([label("fix")], DEFAULT_BRANCH_PREFIX, TASK_ID)).toBe(
      `fix/${TASK_ID}`
    );
  });

  it("takes the first prefixed label, skipping unprefixed ones before it", () => {
    const labels = [label(null), label("feat"), label("fix")];
    expect(resolveWorktreeBranch(labels, DEFAULT_BRANCH_PREFIX, TASK_ID)).toBe(`feat/${TASK_ID}`);
  });

  it("honors a custom default prefix", () => {
    expect(resolveWorktreeBranch([], "wip", TASK_ID)).toBe(`wip/${TASK_ID}`);
    expect(resolveWorktreeBranch([label("fix")], "wip", TASK_ID)).toBe(`fix/${TASK_ID}`);
  });

  it("skips a label with an invalid prefix instead of producing a broken branch", () => {
    expect(resolveWorktreeBranch([label("-bad")], DEFAULT_BRANCH_PREFIX, TASK_ID)).toBe(
      `task/${TASK_ID}`
    );
    expect(
      resolveWorktreeBranch([label("-bad"), label("feat")], DEFAULT_BRANCH_PREFIX, TASK_ID)
    ).toBe(`feat/${TASK_ID}`);
  });

  it("ignores an invalid configured default rather than emitting a broken branch", () => {
    expect(resolveWorktreeBranch([], "..oops", TASK_ID)).toBe(`task/${TASK_ID}`);
  });
});

describe("isValidBranchPrefix", () => {
  it.each(["fix", "feat", "team/frontend", "release-1.2", "a_b.c-d"])("accepts %s", (p) => {
    expect(isValidBranchPrefix(p)).toBe(true);
  });

  it.each(["", "-fix", ".fix", "a..b", "a//b", "feat/", "has space", "we*ird", "~tilde"])(
    "rejects %s",
    (p) => {
      expect(isValidBranchPrefix(p)).toBe(false);
    }
  );
});
