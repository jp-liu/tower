import { describe, expect, it, vi } from "vitest";
import { CommandResolver } from "../src/index.js";

describe("CLI command resolution policy", () => {
  it("prefers connection override, then manifest default/aliases, and keeps known paths as fallback", async () => {
    const existing = new Set([
      "/custom/community",
      "/path/bin/community",
      "/path/bin/community-alias",
      "/known/community",
    ]);
    const execute = vi.fn(async (spec) => ({
      exitCode: 0,
      signal: null,
      stdout: `${spec.command} 1.0.0`,
      stderr: "",
      durationMs: 1,
    }));
    const resolver = new CommandResolver({
      platform: "linux",
      env: { PATH: "/path/bin" },
      homeDir: "/home/test",
      fileSystem: {
        exists: async (candidate) => existing.has(candidate),
        executable: async (candidate) => existing.has(candidate),
      },
      executor: { execute },
    });
    const signal = new AbortController().signal;
    const result = await resolver.resolve({
      commandOverride: "/custom/community",
      defaultCommand: "community",
      aliases: ["community-alias"],
      supplementalPaths: [],
      knownPaths: ["/known/community"],
      cwd: "/workspace",
      env: { PATH: "/path/bin" },
      signal,
    });

    expect(result.selected).toMatchObject({
      path: "/custom/community",
      declarationSource: "command-override",
      state: "runnable",
    });
    expect(result.candidates.map((candidate) => candidate.path)).toEqual([
      "/custom/community",
      "/path/bin/community",
      "/path/bin/community-alias",
      "/known/community",
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ command: "/custom/community" }),
      expect.objectContaining({ signal }),
    );
  });
});
