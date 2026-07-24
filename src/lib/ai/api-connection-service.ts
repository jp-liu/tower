import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ApiConnectionRuntime,
  ApiRuntimeError,
  assertApiProtocol,
  createApiAdapter,
  normalizeBaseUrl,
  parseConfigEntries,
  safeErrorShape,
  serializeConfigEntries,
  type ApiConfigEntry,
  type ApiConnectionRuntimeConfig,
  type ApiCredential,
  type ApiProtocol,
  type ApiRuntimeCursor,
} from "@tower/ai-runtime";
import { db } from "@/lib/db";

const configEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  sensitive: z.boolean(),
});

const connectionInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  protocol: z.enum(["openai", "openai-compatible", "anthropic", "google"]),
  presetId: z.string().trim().max(120).nullable().optional(),
  baseUrl: z.string(),
  defaultModelId: z.string().trim().max(300),
  enabled: z.boolean().default(true),
  headers: z.array(configEntrySchema).default([]),
  queryParams: z.array(configEntrySchema).default([]),
});

const connectionPatchSchema = connectionInputSchema.partial();
const keyInputSchema = z.object({
  label: z.string().trim().max(120).nullable().optional(),
  value: z.string(),
  enabled: z.boolean().default(true),
});
const keyPatchSchema = keyInputSchema.partial();

export type ApiConnectionInput = z.input<typeof connectionInputSchema>;
export type ApiConnectionPatch = z.input<typeof connectionPatchSchema>;
export type ApiKeyInput = z.input<typeof keyInputSchema>;
export type ApiKeyPatch = z.input<typeof keyPatchSchema>;

const connectionInclude = {
  apiKeys: { orderBy: [{ order: "asc" as const }, { createdAt: "asc" as const }] },
  models: { orderBy: { modelId: "asc" as const } },
};

function decodeConnection<T extends {
  headersJson: string;
  queryParamsJson: string;
}>(connection: T) {
  return {
    ...connection,
    headers: parseConfigEntries(connection.headersJson, "header"),
    queryParams: parseConfigEntries(connection.queryParamsJson, "query"),
  };
}

function encodeConfig(input: { headers?: ApiConfigEntry[]; queryParams?: ApiConfigEntry[] }) {
  return {
    ...(input.headers === undefined ? {} : { headersJson: serializeConfigEntries(input.headers, "header") }),
    ...(input.queryParams === undefined
      ? {}
      : { queryParamsJson: serializeConfigEntries(input.queryParams, "query") }),
  };
}

async function requireApiConnection(connectionId: string) {
  const connection = await db.providerConnection.findUnique({
    where: { id: connectionId },
    include: connectionInclude,
  });
  if (!connection || connection.kind !== "api") throw new Error("API connection not found");
  return connection;
}

function runtimeConfig(connection: Awaited<ReturnType<typeof requireApiConnection>>): ApiConnectionRuntimeConfig {
  if (!connection.baseUrl) throw new Error("API connection has no Base URL");
  return {
    connectionId: connection.id,
    protocol: assertApiProtocol(connection.provider),
    name: connection.name,
    baseUrl: connection.baseUrl,
    headers: parseConfigEntries(connection.headersJson, "header"),
    queryParams: parseConfigEntries(connection.queryParamsJson, "query"),
  };
}

class PrismaRuntimeCursor implements ApiRuntimeCursor {
  constructor(private readonly connectionId: string) {}

  async reserve(candidateCount: number): Promise<number> {
    const rows = await db.$queryRawUnsafe<Array<{ reserved: number | bigint }>>(
      `UPDATE "ProviderConnection" SET "roundRobinCursor" = "roundRobinCursor" + 1 ` +
        `WHERE "id" = ? RETURNING "roundRobinCursor" - 1 AS "reserved"`,
      this.connectionId,
    );
    if (!rows[0]) throw new Error("API connection cursor could not be updated");
    return Number(rows[0].reserved) % Math.max(1, candidateCount);
  }
}

export async function listApiConnectionsService() {
  const connections = await db.providerConnection.findMany({
    where: { kind: "api" },
    include: connectionInclude,
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
  });
  return connections.map(decodeConnection);
}

export async function getApiConnectionService(connectionId: string) {
  return decodeConnection(await requireApiConnection(connectionId));
}

export async function createApiConnectionService(input: ApiConnectionInput) {
  const parsed = connectionInputSchema.parse(input);
  const baseUrl = normalizeBaseUrl(parsed.baseUrl);
  const config = encodeConfig(parsed);
  const id = randomUUID();
  const connection = await db.providerConnection.create({
    data: {
      id,
      name: parsed.name,
      kind: "api",
      provider: parsed.protocol,
      enabled: parsed.enabled,
      testStatus: "untested",
      testOk: false,
      presetId: parsed.presetId || null,
      baseUrl,
      defaultModelId: parsed.defaultModelId || null,
      ...config,
    },
    include: connectionInclude,
  });
  return decodeConnection(connection);
}

export async function updateApiConnectionService(connectionId: string, input: ApiConnectionPatch) {
  await requireApiConnection(connectionId);
  const parsed = connectionPatchSchema.parse(input);
  const runtimeChanged =
    parsed.protocol !== undefined ||
    parsed.baseUrl !== undefined ||
    parsed.defaultModelId !== undefined ||
    parsed.headers !== undefined ||
    parsed.queryParams !== undefined;
  if (runtimeChanged) {
    await db.apiConnectionKey.updateMany({
      where: { connectionId },
      data: { testStatus: "untested", lastTestedAt: null, lastError: null },
    });
  }
  const connection = await db.providerConnection.update({
    where: { id: connectionId },
    data: {
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      ...(parsed.protocol === undefined ? {} : { provider: parsed.protocol }),
      ...(parsed.presetId === undefined ? {} : { presetId: parsed.presetId || null }),
      ...(parsed.baseUrl === undefined ? {} : { baseUrl: normalizeBaseUrl(parsed.baseUrl) }),
      ...(parsed.defaultModelId === undefined
        ? {}
        : { defaultModelId: parsed.defaultModelId || null }),
      ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
      ...encodeConfig(parsed),
      ...(runtimeChanged ? { testStatus: "untested", testOk: false } : {}),
    },
    include: connectionInclude,
  });
  return decodeConnection(connection);
}

export async function deleteApiConnectionService(connectionId: string): Promise<void> {
  await requireApiConnection(connectionId);
  await db.providerConnection.delete({ where: { id: connectionId } });
}

export async function setApiConnectionEnabledService(connectionId: string, enabled: boolean) {
  await requireApiConnection(connectionId);
  return db.providerConnection.update({ where: { id: connectionId }, data: { enabled } });
}

export async function listApiKeysService(connectionId: string) {
  await requireApiConnection(connectionId);
  return db.apiConnectionKey.findMany({
    where: { connectionId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

export async function addApiKeyService(connectionId: string, input: ApiKeyInput) {
  await requireApiConnection(connectionId);
  const parsed = keyInputSchema.parse(input);
  const aggregate = await db.apiConnectionKey.aggregate({
    where: { connectionId },
    _max: { order: true },
  });
  const key = await db.apiConnectionKey.create({
    data: {
      connectionId,
      label: parsed.label || null,
      value: parsed.value,
      enabled: parsed.enabled,
      order: (aggregate._max.order ?? -1) + 1,
    },
  });
  await db.providerConnection.update({
    where: { id: connectionId },
    data: { testStatus: "untested", testOk: false },
  });
  return key;
}

export async function updateApiKeyService(connectionId: string, keyId: string, input: ApiKeyPatch) {
  const parsed = keyPatchSchema.parse(input);
  const existing = await db.apiConnectionKey.findFirst({ where: { id: keyId, connectionId } });
  if (!existing) throw new Error("API key not found");
  const key = await db.apiConnectionKey.update({
    where: { id: keyId },
    data: {
      ...(parsed.label === undefined ? {} : { label: parsed.label || null }),
      ...(parsed.value === undefined
        ? {}
        : {
            value: parsed.value,
            testStatus: "untested",
            lastTestedAt: null,
            lastError: null,
          }),
      ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
    },
  });
  await aggregateConnectionStatus(connectionId);
  return key;
}

export async function deleteApiKeyService(connectionId: string, keyId: string): Promise<void> {
  const existing = await db.apiConnectionKey.findFirst({ where: { id: keyId, connectionId } });
  if (!existing) throw new Error("API key not found");
  await db.apiConnectionKey.delete({ where: { id: keyId } });
  await aggregateConnectionStatus(connectionId);
}

export async function reorderApiKeysService(connectionId: string, orderedIds: string[]): Promise<void> {
  const ids = z.array(z.string().min(1)).parse(orderedIds);
  if (new Set(ids).size !== ids.length) throw new Error("API key order contains duplicates");
  const existing = await db.apiConnectionKey.findMany({ where: { connectionId }, select: { id: true } });
  const existingIds = new Set(existing.map((row) => row.id));
  if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
    throw new Error("API key order must include every key exactly once");
  }
  await db.$transaction(ids.map((id, order) => db.apiConnectionKey.update({
    where: { id },
    data: { order },
  })));
}

export async function listApiModelsService(connectionId: string) {
  await requireApiConnection(connectionId);
  return db.apiConnectionModel.findMany({ where: { connectionId }, orderBy: { modelId: "asc" } });
}

export async function addManualApiModelService(connectionId: string, modelIdInput: string) {
  await requireApiConnection(connectionId);
  const modelId = z.string().trim().min(1).max(300).parse(modelIdInput);
  return db.apiConnectionModel.upsert({
    where: { connectionId_modelId: { connectionId, modelId } },
    create: { connectionId, modelId, source: "manual", available: true },
    update: { source: "manual", available: true },
  });
}

export async function removeManualApiModelService(connectionId: string, modelId: string): Promise<void> {
  const model = await db.apiConnectionModel.findUnique({
    where: { connectionId_modelId: { connectionId, modelId } },
  });
  if (!model || model.source !== "manual") throw new Error("Manual model not found");
  await db.apiConnectionModel.delete({ where: { id: model.id } });
}

function discoveryCredential(connection: Awaited<ReturnType<typeof requireApiConnection>>): ApiCredential {
  if (connection.apiKeys.length === 0) return { id: "anonymous", value: "" };
  const key = connection.apiKeys.find((item) => item.enabled && item.testStatus === "ok")
    ?? connection.apiKeys.find((item) => item.enabled);
  if (!key) throw new Error("No enabled API key is available for model discovery");
  return { id: key.id, value: key.value };
}

export async function refreshApiModelsService(connectionId: string) {
  const connection = await requireApiConnection(connectionId);
  const adapter = createApiAdapter(runtimeConfig(connection));
  const result = await adapter.listModels(discoveryCredential(connection));
  if (!result.ok) return result;
  const discoveredAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.apiConnectionModel.updateMany({
      where: { connectionId, source: "discovered" },
      data: { available: false },
    });
    for (const model of result.models) {
      const existing = await tx.apiConnectionModel.findUnique({
        where: { connectionId_modelId: { connectionId, modelId: model.id } },
      });
      const common = {
        available: true,
        lastDiscoveredAt: discoveredAt,
        capabilitiesJson: model.capabilities ? JSON.stringify(model.capabilities) : null,
        metadataJson: model.metadata ? JSON.stringify(model.metadata) : null,
      };
      await tx.apiConnectionModel.upsert({
        where: { connectionId_modelId: { connectionId, modelId: model.id } },
        create: { connectionId, modelId: model.id, source: "discovered", ...common },
        update: { ...common, source: existing?.source === "manual" ? "manual" : "discovered" },
      });
    }
  });
  return result;
}

async function aggregateConnectionStatus(connectionId: string, anonymousOk?: boolean) {
  const allKeys = await db.apiConnectionKey.findMany({ where: { connectionId } });
  const keys = allKeys.filter((key) => key.enabled);
  let status: "untested" | "connected" | "partial" | "unavailable";
  if (allKeys.length > 0 && keys.length === 0) {
    status = "unavailable";
  } else if (keys.length === 0 && anonymousOk !== undefined) {
    status = anonymousOk ? "connected" : "unavailable";
  } else if (keys.length === 0 || keys.every((key) => key.testStatus === "untested")) {
    status = "untested";
  } else {
    const ok = keys.filter((key) => key.testStatus === "ok").length;
    status = ok === keys.length ? "connected" : ok > 0 ? "partial" : "unavailable";
  }
  return db.providerConnection.update({
    where: { id: connectionId },
    data: {
      testStatus: status,
      testOk: status === "connected" || status === "partial",
      lastTestedAt: status === "untested" ? null : new Date(),
    },
  });
}

async function testCredential(
  connection: Awaited<ReturnType<typeof requireApiConnection>>,
  credential: ApiCredential,
  modelId: string,
  signal?: AbortSignal,
) {
  const adapter = createApiAdapter(runtimeConfig(connection));
  try {
    await adapter.testConnection(modelId, credential, signal);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: safeErrorShape(error) };
  }
}

export async function testApiKeyService(
  connectionId: string,
  keyId: string | null,
  modelIdInput?: string,
  signal?: AbortSignal,
) {
  const connection = await requireApiConnection(connectionId);
  const modelId = (modelIdInput ?? connection.defaultModelId)?.trim();
  if (!modelId) throw new Error("A model ID is required for connection testing");
  if (keyId === null) {
    if (connection.apiKeys.length > 0) throw new Error("Anonymous testing requires a connection with zero keys");
    const result = await testCredential(connection, { id: "anonymous", value: "" }, modelId, signal);
    await aggregateConnectionStatus(connectionId, result.ok);
    return result;
  }
  const key = connection.apiKeys.find((item) => item.id === keyId);
  if (!key) throw new Error("API key not found");
  const result = await testCredential(connection, { id: key.id, value: key.value }, modelId, signal);
  await db.apiConnectionKey.update({
    where: { id: key.id },
    data: {
      testStatus: result.ok ? "ok" : "failed",
      lastTestedAt: new Date(),
      lastError: result.ok ? null : result.error.message,
    },
  });
  await aggregateConnectionStatus(connectionId);
  return result;
}

export async function testApiConnectionService(connectionId: string, modelId?: string) {
  const connection = await requireApiConnection(connectionId);
  if (connection.apiKeys.length === 0) {
    return [await testApiKeyService(connectionId, null, modelId)];
  }
  const results = [];
  for (const key of connection.apiKeys.filter((item) => item.enabled)) {
    results.push({ keyId: key.id, ...(await testApiKeyService(connectionId, key.id, modelId)) });
  }
  if (results.length === 0) await aggregateConnectionStatus(connectionId);
  return results;
}

export async function getApiRuntimeService(connectionId: string): Promise<ApiConnectionRuntime> {
  const connection = await requireApiConnection(connectionId);
  if (!connection.enabled || !connection.testOk) {
    throw new ApiRuntimeError({
      code: "invalid_request",
      message: "The API connection is not enabled and available",
      cause: "ConnectionUnavailable",
      retryableWithNextKey: false,
    });
  }
  const credentials = connection.apiKeys
    .filter((key) => key.enabled && key.testStatus === "ok")
    .map((key) => ({ id: key.id, value: key.value }));
  if (connection.apiKeys.length > 0 && credentials.length === 0) {
    throw new ApiRuntimeError({
      code: "authentication",
      message: "No tested API key is available",
      cause: "NoHealthyCredential",
      retryableWithNextKey: false,
    });
  }
  return new ApiConnectionRuntime(
    createApiAdapter(runtimeConfig(connection)),
    credentials,
    new PrismaRuntimeCursor(connection.id),
  );
}
