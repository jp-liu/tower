// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mergeProviderProcess, providerBaseEnvironment } from "../provider-host";

describe("built-in provider host boundary", () => {
  it("merges legacy profile args before provider args and task env last", () => {
    const result = mergeProviderProcess(
      {
        command: "claude",
        args: ["--dangerously-skip-permissions", "prompt"],
        envPatch: { SHARED: "task", TOWER_TASK_ID: "t1" },
      },
      "/resolved/claude",
      {
        command: "custom-claude",
        baseArgs: ["--profile-flag"],
        envPatch: { PROFILE_ONLY: "yes", SHARED: "profile" },
      },
    );

    expect(result.command).toBe("/resolved/claude");
    expect(result.args).toEqual([
      "--profile-flag",
      "--dangerously-skip-permissions",
      "prompt",
    ]);
    expect(result.envPatch).toEqual({
      PROFILE_ONLY: "yes",
      SHARED: "task",
      TOWER_TASK_ID: "t1",
    });
  });

  it("inherits provider auth variables but excludes unrelated sensitive values", () => {
    const env = providerBaseEnvironment("gemini", {
      NODE_ENV: "test",
      PATH: "/bin",
      HOME: "/home/test",
      GEMINI_API_KEY: "provider-key",
      GOOGLE_CLOUD_PROJECT: "project",
      DATABASE_URL: "private-db",
      RANDOM_SECRET: "unrelated",
      OPENAI_API_KEY: "other-provider",
    });

    expect(env.GEMINI_API_KEY).toBe("provider-key");
    expect(env.GOOGLE_CLOUD_PROJECT).toBe("project");
    expect(env.PATH).toBeDefined();
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("RANDOM_SECRET");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });
});
