import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/actions/provider-connection-actions", () => ({ getProviderConnection: vi.fn() }));
vi.mock("@/lib/ai/capability-config-service", async () => {
  class CapabilityServiceError extends Error {
    constructor(public code: string) {
      super("safe capability error");
    }
  }
  return {
    CapabilityServiceError,
    listCapabilityConfigsService: vi.fn(),
    getCapabilityConfigService: vi.fn(),
    replaceCapabilityTargetsService: vi.fn(),
    addCapabilityTargetService: vi.fn(),
    updateCapabilityTargetService: vi.fn(),
    deleteCapabilityTargetService: vi.fn(),
    reorderCapabilityTargetsService: vi.fn(),
    listCapabilityChoicesService: vi.fn(),
    getCapabilityDiagnosticsService: vi.fn(),
  };
});

import { revalidatePath } from "next/cache";
import { getProviderConnection } from "@/actions/provider-connection-actions";
import {
  CapabilityServiceError,
  replaceCapabilityTargetsService,
} from "@/lib/ai/capability-config-service";
import {
  replaceAiCapabilityTargets,
  updateAiCapabilityConfig,
} from "@/actions/ai-config-actions";

const connected = {
  id: "connection-codex",
  connectionKey: "cli:codex",
  name: "codex",
  kind: "cli",
  provider: "codex",
  enabled: true,
  testStatus: "connected",
  lastTestedAt: new Date(),
  testOk: true,
  version: "1",
  mcpInstalled: false,
  hooksInstalled: false,
  skillsInstalled: false,
  installLog: null,
};

describe("ai-config-actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the legacy readiness error", async () => {
    vi.mocked(getProviderConnection).mockResolvedValue(null);
    const result = await updateAiCapabilityConfig("terminal", { provider: "codex", mode: "cli" });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ error: expect.stringContaining("还没有完成连接测试") });
    expect(replaceCapabilityTargetsService).not.toHaveBeenCalled();
  });

  it("translates a legacy single target write to one explicit primary", async () => {
    vi.mocked(getProviderConnection).mockResolvedValue(connected);
    vi.mocked(replaceCapabilityTargetsService).mockResolvedValue({} as never);
    const result = await updateAiCapabilityConfig("terminal", {
      provider: "codex",
      mode: "cli",
      model: "future-model",
    });
    expect(result).toEqual({ ok: true });
    expect(replaceCapabilityTargetsService).toHaveBeenCalledWith("terminal", [{
      connectionId: "connection-codex",
      modelId: "future-model",
    }]);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("does not guess an API instance through the legacy action", async () => {
    vi.mocked(getProviderConnection).mockResolvedValue(connected);
    const result = await updateAiCapabilityConfig("summary", { provider: "codex", mode: "api" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("具体 API 连接") });
    expect(replaceCapabilityTargetsService).not.toHaveBeenCalled();
  });

  it("returns stable structured service errors without raw exceptions", async () => {
    vi.mocked(replaceCapabilityTargetsService)
      .mockRejectedValue(new CapabilityServiceError("duplicate_target" as never));
    const result = await replaceAiCapabilityTargets("summary", []);
    expect(result).toEqual({
      ok: false,
      error: { code: "duplicate_target", message: "safe capability error" },
    });
  });
});
