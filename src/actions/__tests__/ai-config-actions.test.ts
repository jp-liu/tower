import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    aiCapabilityConfig: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    providerConnection: {
      findUnique: vi.fn(),
    },
  },
}));

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { updateAiCapabilityConfig } from "@/actions/ai-config-actions";

const mockDb = db as unknown as {
  aiCapabilityConfig: {
    upsert: ReturnType<typeof vi.fn>;
  };
  providerConnection: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

describe("ai-config-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a user-facing error when selecting an untested provider", async () => {
    mockDb.providerConnection.findUnique.mockResolvedValue(null);

    const result = await updateAiCapabilityConfig("terminal", {
      provider: "codex",
      mode: "cli",
    });

    expect(result).toEqual({
      ok: false,
      error:
        "Codex CLI 还没有完成连接测试。请先在 Settings → AI Tools 点击 Test Connection，测试通过后再选择。",
    });
    expect(mockDb.aiCapabilityConfig.upsert).not.toHaveBeenCalled();
  });

  it("returns the last failed test reason instead of throwing a server action error", async () => {
    mockDb.providerConnection.findUnique.mockResolvedValue({
      provider: "codex",
      lastTestedAt: new Date(),
      testOk: false,
      version: "codex-cli 0.145.0",
      mcpInstalled: false,
      hooksInstalled: false,
      skillsInstalled: false,
      installLog: "codex probe ran but produced no usable response text",
    });

    const result = await updateAiCapabilityConfig("terminal", {
      provider: "codex",
      mode: "cli",
    });

    expect(result).toEqual({
      ok: false,
      error:
        "Codex CLI 最近一次 Test Connection 未通过：codex probe ran but produced no usable response text。请修复后重新测试，再选择为终端 Provider。",
    });
    expect(mockDb.aiCapabilityConfig.upsert).not.toHaveBeenCalled();
  });

  it("updates the terminal slot when the provider probe passed", async () => {
    mockDb.providerConnection.findUnique.mockResolvedValue({
      provider: "codex",
      lastTestedAt: new Date(),
      testOk: true,
      version: "codex-cli 0.145.0",
      mcpInstalled: false,
      hooksInstalled: false,
      skillsInstalled: false,
      installLog: null,
    });

    const result = await updateAiCapabilityConfig("terminal", {
      provider: "codex",
      mode: "cli",
    });

    expect(result).toEqual({ ok: true });
    expect(mockDb.aiCapabilityConfig.upsert).toHaveBeenCalledWith({
      where: { slot: "terminal" },
      create: {
        slot: "terminal",
        provider: "codex",
        mode: "cli",
        model: null,
      },
      update: {
        provider: "codex",
        mode: "cli",
        model: null,
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });
});
