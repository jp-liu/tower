import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    aiCapabilityConfig: { findUnique: vi.fn() },
    providerConnection: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

import { db } from "@/lib/db";
import { providerRegistry } from "../providers";
import {
  resolveCapabilityPlan,
  resolveCliAdapter,
  resolveFixedCliConnection,
} from "../capability-resolver";

type TestConnection = {
  id: string;
  name: string;
  kind: string;
  provider: string;
  enabled: boolean;
  testStatus: string;
  testOk: boolean;
  commandOverride: string | null;
  baseArgsJson: string;
  envVarsJson: string;
  settingsJson: string;
  models: Array<{ modelId: string; available: boolean }>;
  apiKeys: Array<{ enabled: boolean; testStatus: string }>;
};

const mockDb = db as unknown as {
  aiCapabilityConfig: { findUnique: ReturnType<typeof vi.fn> };
  providerConnection: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
};

const connection: TestConnection = {
  id: "connection-cli",
  name: "Claude CLI",
  kind: "cli",
  provider: "claude",
  enabled: true,
  testStatus: "connected",
  testOk: true,
  commandOverride: null,
  baseArgsJson: "[]",
  envVarsJson: "[]",
  settingsJson: "{}",
  models: [],
  apiKeys: [],
};

const resolvedCli = {
  adapter: providerRegistry.get("claude")!.cli!.adapter,
  commandPath: "/fake/claude",
  version: "1",
};

function configWith(targetConnection: TestConnection = connection, modelId: string | null = null) {
  return {
    id: "config",
    slot: "terminal",
    provider: "claude",
    mode: "cli",
    model: modelId,
    migrationStatus: "complete",
    createdAt: new Date(),
    updatedAt: new Date(),
    targets: [{
      id: "target",
      capabilityConfigId: "config",
      connectionId: targetConnection.id,
      modelId,
      targetKey: `${targetConnection.id}\u0000${modelId ?? ""}`,
      order: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      connection: targetConnection,
    }],
  };
}

describe("explicit capability resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(providerRegistry, "createResolvedCliAdapter").mockResolvedValue(resolvedCli);
  });

  it("returns slot_unconfigured instead of an implicit provider", async () => {
    mockDb.aiCapabilityConfig.findUnique.mockResolvedValue(null);
    await expect(resolveCapabilityPlan("terminal")).rejects.toMatchObject({ code: "slot_unconfigured" });
  });

  it("preserves stable target, connection, model, and implementation", async () => {
    mockDb.aiCapabilityConfig.findUnique.mockResolvedValue(configWith(connection, "unknown-future-model"));
    const plan = await resolveCapabilityPlan("terminal");
    expect(plan.targets[0]).toMatchObject({
      targetId: "target",
      connectionId: "connection-cli",
      modelId: "unknown-future-model",
      kind: "cli",
      provider: "claude",
      cli: { commandPath: "/fake/claude" },
    });
  });

  it("marks disabled CLI and unavailable API models for diagnosable fallback", async () => {
    const disabled = { ...connection, enabled: false };
    mockDb.aiCapabilityConfig.findUnique.mockResolvedValue(configWith(disabled));
    expect((await resolveCapabilityPlan("terminal")).targets[0]?.preflightError?.code)
      .toBe("connection_disabled");

    const apiConnection = {
      ...connection,
      id: "connection-api",
      name: "API",
      kind: "api",
      provider: "openai-compatible",
      models: [{ modelId: "gone", available: false }],
    };
    const apiConfig = configWith(apiConnection, "gone");
    apiConfig.slot = "summary";
    apiConfig.mode = "api";
    mockDb.aiCapabilityConfig.findUnique.mockResolvedValue(apiConfig);
    expect((await resolveCapabilityPlan("summary")).targets[0]?.preflightError?.code)
      .toBe("model_unavailable");
  });

  it("accepts CLI and API targets for non-terminal slots", async () => {
    const apiConnection = {
      ...connection,
      id: "connection-api",
      name: "API",
      kind: "api",
      provider: "anthropic",
    };
    const apiConfig = configWith(apiConnection, "claude-future");
    apiConfig.slot = "assistant";
    apiConfig.mode = "api";
    mockDb.aiCapabilityConfig.findUnique.mockResolvedValue(apiConfig);
    const plan = await resolveCapabilityPlan("assistant");
    expect(plan.targets[0]).toMatchObject({ kind: "api", api: { protocol: "anthropic" } });
    expect(plan.targets[0]?.preflightError).toBeUndefined();
  });

  it("keeps legacy wrapper on the explicit primary target", async () => {
    mockDb.aiCapabilityConfig.findUnique.mockResolvedValue(configWith());
    const resolved = await resolveCliAdapter("terminal");
    expect(resolved).toMatchObject({ connectionId: "connection-cli", targetId: "target" });
  });

  it("resolves an enabled third-party CLI without a static source definition", async () => {
    const community = { ...connection, id: "community-connection", name: "Community", provider: "@acme/community-cli" };
    const dynamicProvider = {
      ...providerRegistry.get("claude")!,
      name: community.provider,
      displayName: "Community CLI",
      builtin: false,
    };
    vi.mocked(providerRegistry.createResolvedCliAdapter).mockResolvedValueOnce({
      ...resolvedCli,
      provider: dynamicProvider,
      commandPath: "/fake/community-cli",
    });
    mockDb.aiCapabilityConfig.findUnique.mockResolvedValue(configWith(community));

    const target = (await resolveCapabilityPlan("terminal")).targets[0];
    expect(providerRegistry.get(community.provider)).toBeUndefined();
    expect(target).toMatchObject({
      provider: community.provider,
      cli: { commandPath: "/fake/community-cli", provider: { builtin: false } },
    });
    expect(target?.preflightError).toBeUndefined();
  });

  it("resolves a fixed session by connection id without reading the slot", async () => {
    mockDb.providerConnection.findUnique.mockResolvedValue(connection);
    const resolved = await resolveFixedCliConnection("connection-cli");
    expect(resolved.connectionId).toBe("connection-cli");
    expect(db.aiCapabilityConfig.findUnique).not.toHaveBeenCalled();
  });
});
