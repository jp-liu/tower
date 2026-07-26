"use server";

import { API_PRESET_SNAPSHOT } from "@tower-org/ai-runtime";
import {
  addApiKeyService,
  addManualApiModelService,
  createApiConnectionService,
  deleteApiConnectionService,
  deleteApiKeyService,
  getApiConnectionService,
  listApiConnectionsService,
  listApiKeysService,
  listApiModelsService,
  refreshApiModelsService,
  removeManualApiModelService,
  reorderApiKeysService,
  setApiConnectionEnabledService,
  testApiConnectionService,
  testApiKeyService,
  updateApiConnectionService,
  updateApiKeyService,
  type ApiConnectionInput,
  type ApiConnectionPatch,
  type ApiKeyInput,
  type ApiKeyPatch,
} from "@/lib/ai/api-connection-service";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function action<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const candidateCode = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "invalid_input";
    const message = error instanceof Error ? error.message : "";
    const code = candidateCode === "connection_in_use" || candidateCode === "model_in_use"
      ? candidateCode
      : message.includes("controlled by the transport")
        ? "forbidden_header"
        : "invalid_input";
    return {
      ok: false,
      error: {
        code,
        message: code === "forbidden_header"
          ? "A configured header is controlled by the transport"
          : error instanceof Error && error.message.startsWith("API ")
            ? error.message
            : "The API connection operation could not be completed",
      },
    };
  }
}

export async function listApiConnectionPresets() {
  return {
    source: API_PRESET_SNAPSHOT.source,
    generatedAt: API_PRESET_SNAPSHOT.generatedAt,
    presets: API_PRESET_SNAPSHOT.presets.map((preset) => ({ ...preset })),
  };
}

export async function listApiConnections() { return action(listApiConnectionsService); }
export async function getApiConnection(connectionId: string) {
  return action(() => getApiConnectionService(connectionId));
}
export async function createApiConnection(input: ApiConnectionInput) {
  return action(() => createApiConnectionService(input));
}
export async function updateApiConnection(connectionId: string, input: ApiConnectionPatch) {
  return action(() => updateApiConnectionService(connectionId, input));
}
export async function deleteApiConnection(connectionId: string) {
  return action(() => deleteApiConnectionService(connectionId));
}
export async function setApiConnectionEnabled(connectionId: string, enabled: boolean) {
  return action(() => setApiConnectionEnabledService(connectionId, enabled));
}
export async function listApiKeys(connectionId: string) {
  return action(() => listApiKeysService(connectionId));
}
export async function addApiKey(connectionId: string, input: ApiKeyInput) {
  return action(() => addApiKeyService(connectionId, input));
}
export async function updateApiKey(connectionId: string, keyId: string, input: ApiKeyPatch) {
  return action(() => updateApiKeyService(connectionId, keyId, input));
}
export async function deleteApiKey(connectionId: string, keyId: string) {
  return action(() => deleteApiKeyService(connectionId, keyId));
}
export async function reorderApiKeys(connectionId: string, orderedIds: string[]) {
  return action(() => reorderApiKeysService(connectionId, orderedIds));
}
export async function listApiModels(connectionId: string) {
  return action(() => listApiModelsService(connectionId));
}
export async function addManualApiModel(connectionId: string, modelId: string) {
  return action(() => addManualApiModelService(connectionId, modelId));
}
export async function removeManualApiModel(connectionId: string, modelId: string) {
  return action(() => removeManualApiModelService(connectionId, modelId));
}
export async function refreshApiModels(connectionId: string) {
  return action(() => refreshApiModelsService(connectionId));
}
export async function testApiKey(connectionId: string, keyId: string | null, modelId?: string) {
  return action(() => testApiKeyService(connectionId, keyId, modelId));
}
export async function testApiConnection(connectionId: string, modelId?: string) {
  return action(() => testApiConnectionService(connectionId, modelId));
}
