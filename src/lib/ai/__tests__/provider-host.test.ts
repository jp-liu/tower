// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { providerRegistry } from "../providers";
import {
  createProviderLogger,
  mergeProviderProcess,
  profileForProvider,
  providerBaseEnvironment,
  terminalBaseEnvironment,
} from "../provider-host";

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

  it("keeps the full terminal environment while removing Tower and Claude nesting variables", () => {
    const env = terminalBaseEnvironment({
      NODE_ENV: "test",
      PATH: "/bin",
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      PNPM_HOME: "/tools/pnpm",
      CUSTOM_PROJECT_ENV: "project-value",
      TOWER_DATA_DIR: "/private/tower",
      DATABASE_URL: "private-db",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "nested",
    });

    expect(env).toMatchObject({
      SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
      PNPM_HOME: "/tools/pnpm",
      CUSTOM_PROJECT_ENV: "project-value",
    });
    expect(env).not.toHaveProperty("TOWER_DATA_DIR");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("CLAUDECODE");
    expect(env).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT");
  });

  it.each(["codex", "gemini"])(
    "does not apply a default Claude profile to %s",
    (providerName) => {
      const provider = providerRegistry.get(providerName)!;
      expect(profileForProvider({
        command: "claude",
        baseArgs: ["--legacy-claude"],
        envPatch: { PROFILE_PROVIDER: "claude" },
      }, provider.cli!.plugin)).toEqual({});
    },
  );

  it("accepts provider aliases and Windows shim basenames", () => {
    const provider = providerRegistry.get("codex")!;
    const profile = {
      command: "C:\\Users\\tester\\AppData\\Roaming\\npm\\codex-cli.cmd",
      baseArgs: ["--legacy"],
      envPatch: { PROFILE_ENV: "yes" },
    };
    expect(profileForProvider(profile, provider.cli!.plugin)).toEqual(profile);
  });

  it("redacts SDK-sensitive keys and known secret values from plugin log details", () => {
    const info = vi.fn();
    const logger = createProviderLogger(
      "codex",
      { OPENAI_API_KEY: "unit-test-secret-value" },
      { debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() },
    );

    logger.info("plugin message", {
      apiKey: "never-log-this",
      nested: {
        safe: "prefix unit-test-secret-value suffix",
        label: "visible",
      },
    });

    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("never-log-this");
    expect(logged).not.toContain("unit-test-secret-value");
    expect(logged).toContain("***REDACTED***");
    expect(logged).toContain("visible");
  });
});
