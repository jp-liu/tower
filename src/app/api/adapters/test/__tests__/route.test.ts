// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  connected: vi.fn(),
  disconnected: vi.fn(),
  repair: vi.fn(async () => ({ installed: true, changed: false })),
}));

vi.mock("@/lib/cli-test", () => ({
  testEnvironment: vi.fn(async () => ({
    ok: true,
    checks: [{ name: "codex_version", passed: true, message: "Version: 0.145.0" }],
  })),
}));
vi.mock("@/lib/db", () => ({ db: { project: { findFirst: vi.fn() } } }));
vi.mock("@/lib/ai/install-orchestrator", () => ({ installAllForProvider: mocks.install }));
vi.mock("@/actions/provider-connection-actions", () => ({
  markProviderConnected: mocks.connected,
  markProviderDisconnected: mocks.disconnected,
}));
vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: {
    get: vi.fn(() => ({ cli: { adapter: { hooks: { install: mocks.repair } } } })),
  },
}));

import { POST } from "../route";

describe("adapter test route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a successful Hello Probe connected when integration installation throws", async () => {
    mocks.install.mockRejectedValue(new Error("hook storage unavailable"));
    const request = new NextRequest("http://localhost:3000/api/adapters/test", {
      method: "POST",
      body: JSON.stringify({ provider: "codex" }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.install.ok).toBe(false);
    expect(mocks.connected).toHaveBeenCalledWith("codex", {
      version: "0.145.0",
      report: expect.objectContaining({ provider: "codex", available: true, ok: false }),
    });
    expect(mocks.disconnected).not.toHaveBeenCalled();
  });
});
