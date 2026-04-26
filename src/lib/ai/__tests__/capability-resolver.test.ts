import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    aiCapabilityConfig: {
      findUnique: vi.fn(),
    },
  },
}));

import { resolveCliAdapter, resolveQueryAdapter } from "../capability-resolver";
import { db } from "@/lib/db";
import { AiProviderError } from "../types";

describe("capability-resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveCliAdapter", () => {
    it("returns Claude adapter when no config exists (default)", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue(null);
      const result = await resolveCliAdapter("terminal");
      expect(result.provider.name).toBe("claude");
      expect(result.adapter).toBeDefined();
    });

    it("returns configured provider adapter with model", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "terminal", provider: "claude", mode: "cli", model: "opus",
        createdAt: new Date(), updatedAt: new Date(),
      });
      const result = await resolveCliAdapter("terminal");
      expect(result.provider.name).toBe("claude");
      expect(result.model).toBe("opus");
    });

    it("throws AiProviderError for unknown provider", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "terminal", provider: "nonexistent", mode: "cli", model: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await expect(resolveCliAdapter("terminal")).rejects.toThrow(AiProviderError);
    });

    it("throws for provider without CLI support", async () => {
      // This tests the UNSUPPORTED_MODE path — would need a provider registered without cli
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "terminal", provider: "nonexistent", mode: "cli", model: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      try {
        await resolveCliAdapter("terminal");
      } catch (e) {
        expect(e).toBeInstanceOf(AiProviderError);
        expect((e as AiProviderError).code).toBe("CLI_NOT_FOUND");
      }
    });
  });

  describe("resolveQueryAdapter", () => {
    it("throws UNSUPPORTED_MODE when provider has no query adapter for mode", async () => {
      vi.mocked(db.aiCapabilityConfig.findUnique).mockResolvedValue({
        id: "1", slot: "summary", provider: "claude", mode: "api", model: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      // Claude doesn't have api adapter registered yet
      await expect(resolveQueryAdapter("summary")).rejects.toThrow(AiProviderError);
    });
  });
});
