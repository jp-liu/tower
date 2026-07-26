// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: null as Record<string, unknown> | null,
  findUnique: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  capabilityFindUnique: vi.fn(),
  registryGet: vi.fn(),
  listProviders: vi.fn(),
  resolveConnection: vi.fn(),
  resolveProvider: vi.fn(),
  reconcile: vi.fn(),
  inspect: vi.fn(),
  execute: vi.fn(),
  listPlugins: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    providerConnection: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      upsert: mocks.upsert,
    },
    aiCapabilityConfig: { findUnique: mocks.capabilityFindUnique },
  },
}));
vi.mock("../providers", () => ({
  providerRegistry: {
    get: mocks.registryGet,
    getByAgentFieldValue: vi.fn(),
    listCliProviders: mocks.listProviders,
    createResolvedCliConnectionAdapter: mocks.resolveConnection,
    createResolvedCliAdapter: mocks.resolveProvider,
  },
}));
vi.mock("../install-orchestrator", () => ({
  reconcileResolvedProviderIntegrations: mocks.reconcile,
  inspectResolvedProviderIntegration: mocks.inspect,
}));
vi.mock("../provider-host", () => ({ providerBaseEnvironment: () => ({ PATH: "/fixture/bin" }) }));
vi.mock("../cli-plugin-service", () => ({
  getCliPluginApplication: () => ({ list: mocks.listPlugins }),
}));
vi.mock("@/lib/tower-paths", () => ({ getPackageRoot: () => "/fixture/tower" }));
vi.mock("@tower-org/ai-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tower-org/ai-runtime")>();
  return {
    ...actual,
    ControlledProcessExecutor: class {
      execute = mocks.execute;
    },
  };
});

import {
  reconcileProviderIntegrations,
  reconcileTerminalCapabilityTargets,
} from "../provider-reconciliation";

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "connection-1",
    provider: "codex",
    enabled: true,
    testStatus: "connected",
    testOk: true,
    lastTestedAt: new Date("2026-07-25T00:00:00Z"),
    commandOverride: null,
    baseArgsJson: "[]",
    envVarsJson: "[]",
    settingsJson: "{}",
    resolvedCommand: "/opt/old/codex",
    resolvedVersion: "1.0.0",
    ...overrides,
  };
}

function resolvedProvider() {
  return {
    adapter: {
      buildHelloProbe: vi.fn(() => ({ command: "/opt/new/codex", args: ["exec", "hello"] })),
    },
    provider: {
      name: "codex",
      displayName: "Codex CLI",
      version: "0.1.0",
      agentFieldValue: "CODEX_CLI",
      builtin: true,
      models: { cli: [], api: [] },
    },
    manifest: {
      capabilities: { integrations: { mcp: true, hooks: true, skills: true } },
      permissions: ["integration:mcp", "integration:hooks", "integration:skills"],
    },
    providerVersion: "0.1.0",
    commandPath: "/opt/new/codex",
    version: "2.0.0",
    connectionId: "connection-1",
    configurationDigest: "sha256:safe",
  };
}

describe("provider integration reconciliation host", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection = connection();
    mocks.findUnique.mockImplementation(async () => mocks.connection);
    mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(mocks.connection ?? {}, data);
      return mocks.connection;
    });
    mocks.upsert.mockResolvedValue({});
    mocks.registryGet.mockImplementation((provider: string) => provider === "codex"
      ? { name: "codex", displayName: "Codex CLI", cli: {} }
      : undefined);
    mocks.listProviders.mockResolvedValue([]);
    mocks.listPlugins.mockResolvedValue([]);
    mocks.resolveConnection.mockResolvedValue(resolvedProvider());
    mocks.reconcile.mockResolvedValue({
      provider: "codex",
      available: true,
      ok: true,
      integrationFingerprint: "sha256:fingerprint-new",
      reconciledAt: "2026-07-26T00:00:00.000Z",
      commandPath: "/opt/new/codex",
      cliVersion: "2.0.0",
      desired: { mcp: true, hooks: true, skills: true },
      mcp: { ok: true, method: "cli", detail: "already current" },
      hooks: { ok: true, method: "file", detail: "updated" },
      skill: { ok: true, method: "symlink", detail: "already current" },
    });
    mocks.execute.mockResolvedValue({ exitCode: 0, stdout: "hello", stderr: "" });
  });

  it("repairs and verifies integrations before rerunning Hello after path and version changes", async () => {
    const result = await reconcileProviderIntegrations({
      connectionId: "connection-1",
      trigger: "terminal-spawn",
      cwd: "/fixture/worktree",
    });

    expect(result).toMatchObject({
      status: "connected",
      commandPath: "/opt/new/codex",
      cliVersion: "2.0.0",
      fingerprint: "sha256:fingerprint-new",
      hello: "passed",
    });
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(mocks.execute.mock.invocationCallOrder[0]!);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "connection-1" },
      data: expect.objectContaining({
        testStatus: "connected",
        testOk: true,
        resolvedCommand: "/opt/new/codex",
        resolvedVersion: "2.0.0",
        mcpInstalled: true,
        hooksInstalled: true,
        skillsInstalled: true,
      }),
    }));
  });

  it("can repair before an application-owned Hello without marking the connection ready", async () => {
    mocks.connection = connection({ testOk: false, testStatus: "untested" });

    const result = await reconcileProviderIntegrations({
      provider: "codex",
      trigger: "hello-success",
      skipHello: true,
    });

    expect(result).toMatchObject({ status: "partial", hello: "not-run", diagnosticCode: "hello_pending" });
    expect(mocks.reconcile).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ testOk: false, testStatus: "partial" }),
    }));
  });

  it("retries one partial integration verification without rerunning a successful Hello", async () => {
    mocks.reconcile
      .mockResolvedValueOnce({
        provider: "codex",
        available: true,
        ok: false,
        integrationFingerprint: "sha256:first",
        reconciledAt: "2026-07-26T00:00:00.000Z",
        desired: { mcp: true, hooks: true, skills: true },
        mcp: { ok: true, method: "cli" },
        hooks: { ok: false, method: "file", error: "Hooks verification failed after install" },
        skill: { ok: true, method: "symlink" },
      })
      .mockResolvedValueOnce({
        provider: "codex",
        available: true,
        ok: true,
        integrationFingerprint: "sha256:second",
        reconciledAt: "2026-07-26T00:00:01.000Z",
        desired: { mcp: true, hooks: true, skills: true },
        mcp: { ok: true, method: "cli" },
        hooks: { ok: true, method: "file" },
        skill: { ok: true, method: "symlink" },
      });

    const result = await reconcileProviderIntegrations({
      connectionId: "connection-1",
      trigger: "startup",
    });

    expect(result).toMatchObject({ status: "connected", attempts: 2, fingerprint: "sha256:second" });
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });

  it("retries a failed integration repair during skipHello preflight", async () => {
    mocks.connection = connection({ testOk: false, testStatus: "untested" });
    mocks.reconcile
      .mockResolvedValueOnce({
        provider: "codex",
        available: true,
        ok: false,
        integrationFingerprint: "sha256:first",
        reconciledAt: "2026-07-26T00:00:00.000Z",
        desired: { mcp: true, hooks: true, skills: true },
        mcp: { ok: false, method: "cli", error: "MCP verification failed after install" },
        hooks: { ok: true, method: "file" },
        skill: { ok: true, method: "symlink" },
      })
      .mockResolvedValueOnce({
        provider: "codex",
        available: true,
        ok: true,
        integrationFingerprint: "sha256:second",
        reconciledAt: "2026-07-26T00:00:01.000Z",
        desired: { mcp: true, hooks: true, skills: true },
        mcp: { ok: true, method: "cli" },
        hooks: { ok: true, method: "file" },
        skill: { ok: true, method: "symlink" },
      });

    const result = await reconcileProviderIntegrations({
      connectionId: "connection-1",
      trigger: "hello-success",
      skipHello: true,
    });

    expect(result).toMatchObject({
      status: "partial",
      diagnosticCode: "hello_pending",
      attempts: 2,
      fingerprint: "sha256:second",
    });
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("serializes non-equivalent requests for the same connection and preserves each cwd", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    mocks.resolveConnection
      .mockImplementationOnce(async (_connection: unknown, cwd: string) => {
        expect(cwd).toBe("/worktree/one");
        await firstBlocked;
        return resolvedProvider();
      })
      .mockImplementationOnce(async (_connection: unknown, cwd: string) => {
        expect(cwd).toBe("/worktree/two");
        return resolvedProvider();
      });

    const first = reconcileProviderIntegrations({
      connectionId: "connection-1",
      trigger: "startup",
      cwd: "/worktree/one",
    });
    await vi.waitFor(() => expect(mocks.resolveConnection).toHaveBeenCalledTimes(1));
    const second = reconcileProviderIntegrations({
      connectionId: "connection-1",
      trigger: "terminal-spawn",
      cwd: "/worktree/two",
    });
    await Promise.resolve();
    expect(mocks.resolveConnection).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([first, second]);

    expect(mocks.resolveConnection).toHaveBeenCalledTimes(2);
    expect(mocks.resolveConnection.mock.calls.map((call) => call[1]))
      .toEqual(["/worktree/one", "/worktree/two"]);
  });

  it("shares a fully equivalent in-flight reconciliation request", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    mocks.reconcile.mockImplementationOnce(async () => {
      await blocked;
      return {
        provider: "codex",
        available: true,
        ok: true,
        integrationFingerprint: "sha256:shared",
        reconciledAt: "2026-07-26T00:00:00.000Z",
        desired: { mcp: true, hooks: true, skills: true },
        mcp: { ok: true, method: "cli" },
        hooks: { ok: true, method: "file" },
        skill: { ok: true, method: "symlink" },
      };
    });
    const request = {
      connectionId: "connection-1",
      trigger: "terminal-spawn" as const,
      cwd: "/worktree/shared",
    };

    const first = reconcileProviderIntegrations(request);
    await vi.waitFor(() => expect(mocks.reconcile).toHaveBeenCalledTimes(1));
    const second = reconcileProviderIntegrations(request);
    await Promise.resolve();
    expect(mocks.resolveConnection).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);

    expect(mocks.resolveConnection).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });

  it("queues helloAlreadySucceeded behind skipHello and persists the final connected state", async () => {
    mocks.connection = connection({ testOk: false, testStatus: "untested" });
    let releasePreflight!: () => void;
    const preflightBlocked = new Promise<void>((resolve) => { releasePreflight = resolve; });
    mocks.reconcile.mockImplementationOnce(async () => {
      await preflightBlocked;
      return {
        provider: "codex",
        available: true,
        ok: true,
        integrationFingerprint: "sha256:preflight",
        reconciledAt: "2026-07-26T00:00:00.000Z",
        desired: { mcp: true, hooks: true, skills: true },
        mcp: { ok: true, method: "cli" },
        hooks: { ok: true, method: "file" },
        skill: { ok: true, method: "symlink" },
      };
    });

    const preflight = reconcileProviderIntegrations({
      connectionId: "connection-1",
      trigger: "hello-success",
      skipHello: true,
    });
    await vi.waitFor(() => expect(mocks.reconcile).toHaveBeenCalledTimes(1));
    const finalization = reconcileProviderIntegrations({
      connectionId: "connection-1",
      trigger: "hello-success",
      helloAlreadySucceeded: true,
    });
    await Promise.resolve();
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);

    releasePreflight();
    const [preflightResult, finalResult] = await Promise.all([preflight, finalization]);

    expect(preflightResult).toMatchObject({ status: "partial", diagnosticCode: "hello_pending" });
    expect(finalResult).toMatchObject({ status: "connected", hello: "passed" });
    expect(mocks.connection).toMatchObject({ testStatus: "connected", testOk: true });
    expect(mocks.reconcile).toHaveBeenCalledTimes(2);
  });

  it("isolates one terminal candidate reconciliation exception and continues with the next", async () => {
    const firstConnection = connection({ id: "connection-1", provider: "codex" });
    const secondConnection = connection({ id: "connection-2", provider: "gemini" });
    mocks.capabilityFindUnique.mockResolvedValue({
      targets: [
        { connection: { id: "connection-1", provider: "codex", kind: "cli", enabled: true } },
        { connection: { id: "connection-2", provider: "gemini", kind: "cli", enabled: true } },
      ],
    });
    mocks.registryGet.mockImplementation((provider: string) =>
      provider === "codex" || provider === "gemini" ? { name: provider, cli: {} } : undefined);
    mocks.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === "connection-2" ? secondConnection : firstConnection);
    mocks.reconcile
      .mockRejectedValueOnce(new Error("temporary config failure"))
      .mockResolvedValueOnce({
        provider: "gemini",
        available: true,
        ok: true,
        integrationFingerprint: "sha256:gemini",
        reconciledAt: "2026-07-26T00:00:00.000Z",
        desired: { mcp: true, hooks: false, skills: true },
        mcp: { ok: true, method: "cli" },
        skill: { ok: true, method: "symlink" },
      });

    const failures = await reconcileTerminalCapabilityTargets("/fixture/worktree");

    expect(failures.get("connection-1")).toMatchObject({ code: "connection_unavailable" });
    expect(failures.has("connection-2")).toBe(false);
    expect(mocks.resolveConnection).toHaveBeenCalledTimes(2);
  });

  it("marks a candidate unavailable after repair verification exhausts its retry and keeps reconciling", async () => {
    const firstConnection = connection({ id: "connection-1", provider: "codex" });
    const secondConnection = connection({ id: "connection-2", provider: "gemini" });
    mocks.capabilityFindUnique.mockResolvedValue({
      targets: [
        { connection: { id: "connection-1", provider: "codex", kind: "cli", enabled: true } },
        { connection: { id: "connection-2", provider: "gemini", kind: "cli", enabled: true } },
      ],
    });
    mocks.registryGet.mockImplementation((provider: string) =>
      provider === "codex" || provider === "gemini" ? { name: provider, cli: {} } : undefined);
    mocks.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === "connection-2" ? secondConnection : firstConnection);
    const failedReport = {
      provider: "codex",
      available: true,
      ok: false,
      integrationFingerprint: "sha256:failed",
      reconciledAt: "2026-07-26T00:00:00.000Z",
      desired: { mcp: true, hooks: true, skills: true },
      mcp: { ok: false, method: "cli", error: "MCP verification failed after install" },
      hooks: { ok: true, method: "file" },
      skill: { ok: true, method: "symlink" },
    };
    mocks.reconcile
      .mockResolvedValueOnce(failedReport)
      .mockResolvedValueOnce(failedReport)
      .mockResolvedValueOnce({
        provider: "gemini",
        available: true,
        ok: true,
        integrationFingerprint: "sha256:gemini",
        reconciledAt: "2026-07-26T00:00:01.000Z",
        desired: { mcp: true, hooks: false, skills: true },
        mcp: { ok: true, method: "cli" },
        skill: { ok: true, method: "symlink" },
      });

    const failures = await reconcileTerminalCapabilityTargets("/fixture/worktree");

    expect(failures.get("connection-1")).toMatchObject({ code: "connection_unavailable" });
    expect(failures.has("connection-2")).toBe(false);
    expect(mocks.reconcile).toHaveBeenCalledTimes(3);
  });

  it("does not inspect, install, or run Hello when the CLI version is incompatible", async () => {
    mocks.resolveConnection.mockRejectedValue(new Error("cli_dependency_incompatible"));

    const result = await reconcileProviderIntegrations({
      connectionId: "connection-1",
      trigger: "dependency-changed",
    });

    expect(result).toMatchObject({
      status: "dependency-incompatible",
      available: false,
      hello: "not-run",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        testStatus: "dependency-incompatible",
        testOk: false,
      }),
    }));
  });

  it("does not load or activate a dynamic Provider whose permission confirmation is stale", async () => {
    mocks.connection = connection({ provider: "@acme/community" });
    mocks.registryGet.mockReturnValue(undefined);
    mocks.listProviders.mockResolvedValue([]);
    mocks.listPlugins.mockResolvedValue([{
      id: "@acme/community",
      enabled: true,
      permissionConfirmed: false,
      health: "ready",
    }]);

    const result = await reconcileProviderIntegrations({
      connectionId: "connection-1",
      trigger: "startup",
    });

    expect(result).toMatchObject({ status: "permission-required", diagnosticCode: "permission_required" });
    expect(mocks.resolveConnection).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
