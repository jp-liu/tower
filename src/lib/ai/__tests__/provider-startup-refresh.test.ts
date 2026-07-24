// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { CliAdapter } from "@tower/ai-sdk";
import { providerRefreshVersion, repairHooksBeforeResolve } from "../provider-startup-refresh";

describe("provider startup refresh", () => {
  it("repairs hooks before checking command availability", async () => {
    const calls: string[] = [];
    const adapter = {
      hooks: {
        install: vi.fn(async () => {
          calls.push("repair");
          return { installed: true, changed: true };
        }),
      },
    } as unknown as CliAdapter;

    const result = await repairHooksBeforeResolve(adapter, async () => {
      calls.push("resolve-missing-cli");
      return null;
    });

    expect(result).toBeNull();
    expect(calls).toEqual(["repair", "resolve-missing-cli"]);
    expect(adapter.hooks?.install).toHaveBeenCalledWith({ repairOnly: true });
  });

  it("uses the resolved version and otherwise preserves the recorded version", () => {
    expect(providerRefreshVersion("0.145.1", "0.145.0")).toBe("0.145.1");
    expect(providerRefreshVersion(null, "0.145.0")).toBe("0.145.0");
    expect(providerRefreshVersion(undefined, null)).toBeNull();
  });
});
