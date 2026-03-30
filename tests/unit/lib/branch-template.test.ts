// @vitest-environment node
import { describe, it, expect } from "vitest";
import { interpolateBranchTemplate, validateBranchTemplate } from "@/lib/branch-template";

describe("interpolateBranchTemplate", () => {
  it("replaces {taskIdShort} with first 4 chars of taskId", () => {
    const result = interpolateBranchTemplate("vk/{taskIdShort}-", "abc1def2");
    expect(result).toBe("vk/abc1-");
  });

  it("replaces {taskId} with full taskId", () => {
    const result = interpolateBranchTemplate("feature/{taskId}", "abc1def2");
    expect(result).toBe("feature/abc1def2");
  });

  it("replaces both {taskIdShort} and {taskId} in the same template", () => {
    const result = interpolateBranchTemplate("{taskIdShort}/{taskId}", "abc1def2");
    expect(result).toBe("abc1/abc1def2");
  });

  it("returns template unchanged when no placeholders present", () => {
    const result = interpolateBranchTemplate("no-placeholder", "abc1def2");
    expect(result).toBe("no-placeholder");
  });

  it("uses only the first 4 characters for {taskIdShort}", () => {
    const result = interpolateBranchTemplate("{taskIdShort}", "xyz9");
    expect(result).toBe("xyz9");
  });

  it("handles empty taskId gracefully", () => {
    const result = interpolateBranchTemplate("vk/{taskIdShort}-", "");
    expect(result).toBe("vk/-");
  });
});

describe("validateBranchTemplate", () => {
  it("returns true when template contains {taskIdShort}", () => {
    expect(validateBranchTemplate("vk/{taskIdShort}-")).toBe(true);
  });

  it("returns true when template contains {taskId}", () => {
    expect(validateBranchTemplate("feature/{taskId}")).toBe(true);
  });

  it("returns true when template contains both placeholders", () => {
    expect(validateBranchTemplate("{taskIdShort}/{taskId}")).toBe(true);
  });

  it("returns false when template contains no placeholder", () => {
    expect(validateBranchTemplate("no-placeholder")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(validateBranchTemplate("")).toBe(false);
  });
});
