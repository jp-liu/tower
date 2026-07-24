import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    aiCapabilityConfig: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/actions/provider-connection-actions", () => ({
  isProviderConnected: vi.fn(),
  getConnectedProviders: vi.fn(),
}));

import { resolveCliAdapter, resolveQueryAdapter } from "../capability-resolver";
import { db } from "@/lib/db";
import { AiProviderError } from "../types";
import {
  isProviderConnected,
  getConnectedProviders,
} from "@/actions/provider-connection-actions";

const mockIsConnected = vi.mocked(isProviderConnected);
const mockGetConnected = vi.mocked(getConnectedProviders);

describe("capability-resolver (gated by ProviderConnection)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveCliAdapter — no slot config", () => {
    it("uses default provider (claude) when it's connected", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue(null);
      mockGetConnected.mockResolvedValue(["claude", "codex"]);

      const result = await resolveCliAdapter("terminal");
      expect(result.provider.name).toBe("claude");
    });

    it("falls back to first connected provider when default isn't connected", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue(null);
      mockGetConnected.mockResolvedValue(["codex"]);

      const result = await resolveCliAdapter("terminal");
      expect(result.provider.name).toBe("codex");
    });

    it("throws when no provider is connected at all", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue(null);
      mockGetConnected.mockResolvedValue([]);

      await expect(resolveCliAdapter("terminal")).rejects.toThrow(/没有任何 AI Provider 已连接/);
    });
  });

  describe("resolveCliAdapter — slot config present", () => {
    it("keeps an execution pinned to its recorded provider when the slot changes", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "terminal", provider: "claude", mode: "cli", model: null,
        createdAt: new Date(), updatedAt: new Date(),
      });

      const result = await resolveCliAdapter("terminal", "gemini");

      expect(result.provider.name).toBe("gemini");
      expect(mockIsConnected).not.toHaveBeenCalled();
    });

    it("returns adapter + model when configured provider is connected", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "terminal", provider: "claude", mode: "cli", model: "opus",
        createdAt: new Date(), updatedAt: new Date(),
      });
      mockIsConnected.mockResolvedValue(true);

      const result = await resolveCliAdapter("terminal");
      expect(result.provider.name).toBe("claude");
      expect(result.model).toBe("opus");
    });

    it("throws AiProviderError when configured provider is not connected", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "terminal", provider: "claude", mode: "cli", model: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      mockIsConnected.mockResolvedValue(false);

      await expect(resolveCliAdapter("terminal")).rejects.toThrow(AiProviderError);
      await expect(resolveCliAdapter("terminal")).rejects.toThrow(/未连接/);
    });

    it("throws for unknown provider name in config", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "terminal", provider: "nonexistent", mode: "cli", model: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      mockIsConnected.mockResolvedValue(true); // pretend it's "connected"

      // Even if marked connected, registry doesn't know the provider → throws.
      await expect(resolveCliAdapter("terminal")).rejects.toThrow(AiProviderError);
    });
  });

  describe("resolveQueryAdapter", () => {
    it("requires connection on the configured provider", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "summary", provider: "claude", mode: "api", model: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      mockIsConnected.mockResolvedValue(false);

      await expect(resolveQueryAdapter("summary")).rejects.toThrow(/未连接/);
    });

    it("throws UNSUPPORTED_MODE when provider lacks adapter for the mode", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "summary", provider: "claude", mode: "api", model: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      mockIsConnected.mockResolvedValue(true);

      // Claude has no api query adapter registered → UNSUPPORTED_MODE.
      await expect(resolveQueryAdapter("summary")).rejects.toThrow(AiProviderError);
    });
  });
});
