// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  connected: vi.fn(),
  disconnected: vi.fn(),
  repair: vi.fn(async () => ({ installed: true, changed: false })),
  pluginProbe: vi.fn(),
  testEnvironment: vi.fn(),
  projectFindFirst: vi.fn(),
  registryGet: vi.fn(),
  resolveAdapter: vi.fn(),
}));

vi.mock("@/lib/cli-test", () => ({
  testEnvironment: mocks.testEnvironment,
}));
vi.mock("@/lib/db", () => ({ db: { project: { findFirst: mocks.projectFindFirst } } }));
vi.mock("@/lib/ai/install-orchestrator", () => ({ installAllForProvider: mocks.install }));
vi.mock("@/actions/provider-connection-actions", () => ({
  markProviderConnected: mocks.connected,
  markProviderDisconnected: mocks.disconnected,
}));
vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: {
    get: mocks.registryGet,
    createResolvedCliAdapter: mocks.resolveAdapter,
  },
}));
vi.mock("@/lib/ai/cli-plugin-provider", () => ({
  testPluginCliConnection: mocks.pluginProbe,
}));

import { POST, runtime } from "../route";

describe("adapter test route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.testEnvironment.mockResolvedValue({
      ok: true,
      checks: [{ name: "codex_version", passed: true, message: "Version: 0.145.0" }],
    });
    mocks.registryGet.mockImplementation((provider: string) => provider === "codex"
      ? {
          builtin: true,
          cli: {
            adapter: { hooks: { install: mocks.repair } },
            plugin: {
              manifest: {
                capabilities: { integrations: { hooks: true } },
                permissions: ["integration:hooks"],
              },
            },
          },
        }
      : undefined);
  });

  it("uses the Node runtime and rejects non-local requests before any side effect", async () => {
    const request = new NextRequest("http://tower.example/api/adapters/test", {
      method: "POST",
      body: JSON.stringify({ provider: "@acme/community-cli", cwd: "/private/project" }),
      headers: { "content-type": "application/json", host: "tower.example" },
    });

    const response = await POST(request);

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(403);
    expect(mocks.projectFindFirst).not.toHaveBeenCalled();
    expect(mocks.registryGet).not.toHaveBeenCalled();
    expect(mocks.resolveAdapter).not.toHaveBeenCalled();
    expect(mocks.testEnvironment).not.toHaveBeenCalled();
    expect(mocks.pluginProbe).not.toHaveBeenCalled();
    expect(mocks.repair).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.connected).not.toHaveBeenCalled();
    expect(mocks.disconnected).not.toHaveBeenCalled();
  });

  it("keeps a successful Hello Probe connected when integration installation throws", async () => {
    mocks.install.mockRejectedValue(new Error("hook storage unavailable"));
    const request = new NextRequest("http://localhost:3000/api/adapters/test", {
      method: "POST",
      body: JSON.stringify({ provider: "codex" }),
      headers: { "content-type": "application/json", host: "localhost:3000" },
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
    expect(mocks.repair).toHaveBeenCalledWith({ repairOnly: true });
  });

  it("uses the dynamic plugin Hello probe for providers without static definitions", async () => {
    mocks.pluginProbe.mockResolvedValue({ version: "1.2.3" });
    mocks.install.mockResolvedValue({
      provider: "@acme/community-cli",
      available: true,
      ok: true,
    });
    const request = new NextRequest("http://localhost:3000/api/adapters/test", {
      method: "POST",
      body: JSON.stringify({ provider: "@acme/community-cli" }),
      headers: { "content-type": "application/json", host: "localhost:3000" },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(body.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "@acme/community-cli_hello", passed: true }),
    ]));
    expect(mocks.pluginProbe).toHaveBeenCalledWith("@acme/community-cli");
    expect(mocks.resolveAdapter).not.toHaveBeenCalled();
    expect(mocks.repair).not.toHaveBeenCalled();
  });

  it("does not repair hooks for a dynamic plugin that exports hooks without declaring permission", async () => {
    mocks.pluginProbe.mockResolvedValue({ version: "1.2.3" });
    mocks.resolveAdapter.mockResolvedValue({
      adapter: { hooks: { install: mocks.repair } },
      commandPath: "/usr/local/bin/unapproved-hooks",
    });
    mocks.install.mockResolvedValue({
      provider: "@acme/unapproved-hooks",
      available: true,
      ok: true,
    });

    await POST(new NextRequest("http://localhost:3000/api/adapters/test", {
      method: "POST",
      body: JSON.stringify({ provider: "@acme/unapproved-hooks" }),
      headers: { "content-type": "application/json", host: "localhost:3000" },
    }));

    expect(mocks.pluginProbe).toHaveBeenCalledWith("@acme/unapproved-hooks");
    expect(mocks.resolveAdapter).not.toHaveBeenCalled();
    expect(mocks.repair).not.toHaveBeenCalled();
  });
});
