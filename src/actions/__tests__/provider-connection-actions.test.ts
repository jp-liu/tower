import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    providerConnection: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  markProviderConnected,
  markProviderDisconnected,
  isProviderConnected,
  getConnectedProviders,
} from "@/actions/provider-connection-actions";
import type { ProviderInstallReport } from "@/lib/ai/install-orchestrator";

const mockDb = db as unknown as {
  providerConnection: {
    upsert: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

describe("provider-connection-actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("markProviderConnected", () => {
    it("upserts with testOk=true and reflects install report flags", async () => {
      const report: ProviderInstallReport = {
        provider: "claude",
        available: true,
        ok: true,
        mcp: { ok: true, method: "cli", detail: "claude mcp add-json ..." },
        hooks: { ok: true, method: "file", detail: "~/.claude/settings.json" },
        skill: { ok: true, method: "symlink", detail: "~/.claude/skills/tower → ..." },
      };

      await markProviderConnected("claude", { version: "1.0.0", report });

      const call = mockDb.providerConnection.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ provider: "claude" });
      expect(call.create.testOk).toBe(true);
      expect(call.create.mcpInstalled).toBe(true);
      expect(call.create.hooksInstalled).toBe(true);
      expect(call.create.skillsInstalled).toBe(true);
      expect(call.create.version).toBe("1.0.0");
      expect(JSON.parse(call.create.installLog)).toEqual(report);
    });

    it("records failed install steps even when test passed", async () => {
      const report: ProviderInstallReport = {
        provider: "codex",
        available: true,
        ok: false,
        mcp: { ok: true, method: "cli", detail: "codex mcp add ..." },
        hooks: { ok: false, method: "file", detail: "~/.codex/hooks.json", error: "EACCES" },
        skill: { ok: true, method: "symlink", detail: "~/.codex/skills/tower → ..." },
      };

      await markProviderConnected("codex", { report });

      const call = mockDb.providerConnection.upsert.mock.calls[0][0];
      expect(call.create.mcpInstalled).toBe(true);
      expect(call.create.hooksInstalled).toBe(false);
      expect(call.create.skillsInstalled).toBe(true);
    });
  });

  describe("markProviderDisconnected", () => {
    it("clears all install flags and stores reason", async () => {
      await markProviderDisconnected("codex", { reason: "hello probe failed" });

      const call = mockDb.providerConnection.upsert.mock.calls[0][0];
      expect(call.update.testOk).toBe(false);
      expect(call.update.mcpInstalled).toBe(false);
      expect(call.update.hooksInstalled).toBe(false);
      expect(call.update.skillsInstalled).toBe(false);
      expect(call.update.installLog).toBe("hello probe failed");
    });
  });

  describe("isProviderConnected", () => {
    it("returns false when no row exists", async () => {
      mockDb.providerConnection.findUnique.mockResolvedValue(null);
      expect(await isProviderConnected("claude")).toBe(false);
    });

    it("returns true only when test passed AND every integration installed", async () => {
      mockDb.providerConnection.findUnique.mockResolvedValue({
        testOk: true,
        mcpInstalled: true,
        hooksInstalled: true,
        skillsInstalled: true,
      });
      expect(await isProviderConnected("claude")).toBe(true);
    });

    it("returns false when test passed but mcp install failed", async () => {
      mockDb.providerConnection.findUnique.mockResolvedValue({
        testOk: true,
        mcpInstalled: false,
        hooksInstalled: true,
        skillsInstalled: true,
      });
      expect(await isProviderConnected("claude")).toBe(false);
    });

    it("returns false when probe failed regardless of installs", async () => {
      mockDb.providerConnection.findUnique.mockResolvedValue({
        testOk: false,
        mcpInstalled: true,
        hooksInstalled: true,
        skillsInstalled: true,
      });
      expect(await isProviderConnected("claude")).toBe(false);
    });
  });

  describe("getConnectedProviders", () => {
    it("queries with all flags set to true", async () => {
      mockDb.providerConnection.findMany.mockResolvedValue([
        { provider: "claude" },
        { provider: "codex" },
      ]);
      const list = await getConnectedProviders();
      expect(list).toEqual(["claude", "codex"]);
      const call = mockDb.providerConnection.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        testOk: true,
        mcpInstalled: true,
        hooksInstalled: true,
        skillsInstalled: true,
      });
    });
  });
});
