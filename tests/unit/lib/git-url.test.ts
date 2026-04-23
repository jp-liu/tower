// @vitest-environment node
import { describe, it, expect } from "vitest";
import os from "os";

// Import the functions we're about to add
// These imports will fail until we implement them (RED phase)
import { matchGitPathRule, type GitPathRule } from "@/lib/git-url";

const home = os.homedir();

function makeRule(overrides: Partial<GitPathRule> & Pick<GitPathRule, "host" | "ownerMatch" | "localPathTemplate">): GitPathRule {
  return {
    id: "test-rule-id",
    priority: 0,
    ...overrides,
  };
}

describe("matchGitPathRule", () => {
  describe("exact owner match", () => {
    it("returns interpolated path for exact owner match (HTTPS URL)", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "jp-liu",
          localPathTemplate: "~/project/i/{repo}",
          priority: 0,
        }),
      ];
      const result = matchGitPathRule("https://github.com/jp-liu/my-repo", rules);
      expect(result).toBe(`${home}/project/i/my-repo`);
    });

    it("returns interpolated path for wildcard * owner match", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "*",
          localPathTemplate: "~/project/f/{repo}",
          priority: 10,
        }),
      ];
      const result = matchGitPathRule("https://github.com/jp-liu/my-repo", rules);
      expect(result).toBe(`${home}/project/f/my-repo`);
    });

    it("respects priority: specific owner (priority=0) wins over wildcard (priority=10)", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "jp-liu",
          localPathTemplate: "~/project/i/{repo}",
          priority: 0,
        }),
        makeRule({
          id: "wildcard-rule",
          host: "github.com",
          ownerMatch: "*",
          localPathTemplate: "~/project/f/{repo}",
          priority: 10,
        }),
      ];
      const result = matchGitPathRule("https://github.com/jp-liu/my-repo", rules);
      expect(result).toBe(`${home}/project/i/my-repo`);
    });

    it("exact owner match wins over wildcard regardless of priority number", () => {
      const rules: GitPathRule[] = [
        makeRule({
          id: "wildcard-rule",
          host: "github.com",
          ownerMatch: "*",
          localPathTemplate: "~/project/f/{repo}",
          priority: 0,
        }),
        makeRule({
          host: "github.com",
          ownerMatch: "jp-liu",
          localPathTemplate: "~/project/i/{repo}",
          priority: 10,
        }),
      ];
      const result = matchGitPathRule("https://github.com/jp-liu/my-repo", rules);
      // Exact owner (jp-liu) takes priority over wildcard (*) even with lower priority number
      expect(result).toBe(`${home}/project/i/my-repo`);
    });
  });

  describe("no match cases", () => {
    it("returns empty string when host does not match", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "jp-liu",
          localPathTemplate: "~/project/i/{repo}",
        }),
      ];
      const result = matchGitPathRule("https://unknown.com/foo/bar", rules);
      expect(result).toBe("");
    });

    it("returns empty string for empty URL input", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "*",
          localPathTemplate: "~/project/f/{repo}",
        }),
      ];
      const result = matchGitPathRule("", rules);
      expect(result).toBe("");
    });

    it("returns empty string for unparseable URL", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "*",
          localPathTemplate: "~/project/f/{repo}",
        }),
      ];
      const result = matchGitPathRule("not-a-url", rules);
      expect(result).toBe("");
    });

    it("returns empty string with empty rules array", () => {
      const result = matchGitPathRule("https://github.com/owner/repo", []);
      expect(result).toBe("");
    });

    it("returns empty string when owner does not match and no wildcard", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "other-owner",
          localPathTemplate: "~/project/f/{repo}",
        }),
      ];
      const result = matchGitPathRule("https://github.com/jp-liu/my-repo", rules);
      expect(result).toBe("");
    });
  });

  describe("template interpolation", () => {
    it("interpolates both {owner} and {repo} tokens", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "jp-liu",
          localPathTemplate: "~/code/{owner}/{repo}",
        }),
      ];
      const result = matchGitPathRule("https://github.com/jp-liu/my-repo", rules);
      expect(result).toBe(`${home}/code/jp-liu/my-repo`);
    });

    it("expands ~ to home directory", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "*",
          localPathTemplate: "~/project/f/{repo}",
        }),
      ];
      const result = matchGitPathRule("https://github.com/anyone/test-repo", rules);
      expect(result).toBe(`${home}/project/f/test-repo`);
    });
  });

  describe("SSH URL support", () => {
    it("handles SSH shorthand URL (git@ format)", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "jp-liu",
          localPathTemplate: "~/project/i/{repo}",
        }),
      ];
      const result = matchGitPathRule("git@github.com:jp-liu/my-repo.git", rules);
      expect(result).toBe(`${home}/project/i/my-repo`);
    });

    it("handles SSH wildcard match", () => {
      const rules: GitPathRule[] = [
        makeRule({
          host: "github.com",
          ownerMatch: "*",
          localPathTemplate: "~/project/f/{repo}",
        }),
      ];
      const result = matchGitPathRule("git@github.com:someowner/some-repo.git", rules);
      expect(result).toBe(`${home}/project/f/some-repo`);
    });
  });
});
