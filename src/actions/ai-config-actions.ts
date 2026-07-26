"use server";

import { revalidatePath } from "next/cache";
import { providerRegistry } from "@/lib/ai/providers";
import type { AiSlot } from "@/lib/ai/types";
import {
  CapabilityServiceError,
  addCapabilityTargetService,
  deleteCapabilityTargetService,
  getCapabilityConfigService,
  getCapabilityDiagnosticsService,
  listCapabilityChoicesService,
  listCapabilityConfigsService,
  reorderCapabilityTargetsService,
  replaceCapabilityTargetsService,
  updateCapabilityTargetService,
  type CapabilityTargetInput,
} from "@/lib/ai/capability-config-service";
import {
  getProviderConnection,
  type ProviderConnectionRow,
} from "@/actions/provider-connection-actions";

const VALID_SLOTS: AiSlot[] = ["terminal", "summary", "dreaming", "analysis", "assistant"];

export type UpdateAiCapabilityConfigResult =
  | { ok: true }
  | { ok: false; error: string };

export async function getAiCapabilityConfigs() {
  return listCapabilityConfigsService();
}

export async function updateAiCapabilityConfig(
  slot: string,
  data: { provider: string; mode: string; model?: string | null }
): Promise<UpdateAiCapabilityConfigResult> {
  if (!VALID_SLOTS.includes(slot as AiSlot)) {
    return { ok: false, error: `无效的 AI 能力插槽：${slot}` };
  }

  const providerDef = providerRegistry.get(data.provider);
  if (!providerDef) {
    return { ok: false, error: `未知的 Provider：${data.provider}` };
  }

  if (slot === "terminal" && data.mode !== "cli") {
    return { ok: false, error: "终端执行只支持 CLI 模式" };
  }

  // Gate: terminal execution only needs a passing CLI probe. MCP/hooks/skills
  // are surfaced separately as degraded integration status in Settings.
  let connection: ProviderConnectionRow | null;
  try {
    connection = await getProviderConnection(data.provider);
  } catch {
    return { ok: false, error: "AI 能力配置暂时无法读取，请稍后重试。" };
  }
  if (!connection?.testOk) {
    return {
      ok: false,
      error: buildProviderNotReadyMessage(providerDef.displayName, connection),
    };
  }

  if (data.mode !== "cli") {
    return {
      ok: false,
      error: "旧版设置入口无法确定具体 API 连接，请在显式目标配置中选择连接实例。",
    };
  }

  try {
    await replaceCapabilityTargetsService(slot, [{
      connectionId: connection.id,
      modelId: data.model ?? null,
    }]);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof CapabilityServiceError
        ? error.message
        : "AI 能力配置无法保存，请稍后重试。",
    };
  }

  revalidatePath("/settings");
  return { ok: true };
}

export async function getAvailableProviders() {
  return providerRegistry.getAvailableProviders();
}

export async function getRegisteredProviders() {
  return providerRegistry.getRegisteredProviders();
}

type CapabilityActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

async function capabilityAction<T>(operation: () => Promise<T>): Promise<CapabilityActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    if (error instanceof CapabilityServiceError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    return {
      ok: false,
      error: {
        code: "capability_operation_failed",
        message: "The AI capability operation could not be completed",
      },
    };
  }
}

async function mutateCapability<T>(operation: () => Promise<T>): Promise<CapabilityActionResult<T>> {
  const result = await capabilityAction(operation);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function listAiCapabilities() {
  return capabilityAction(listCapabilityConfigsService);
}

export async function getAiCapability(slot: string) {
  return capabilityAction(() => getCapabilityConfigService(slot));
}

export async function replaceAiCapabilityTargets(slot: string, targets: CapabilityTargetInput[]) {
  return mutateCapability(() => replaceCapabilityTargetsService(slot, targets));
}

export async function addAiCapabilityTarget(slot: string, target: CapabilityTargetInput) {
  return mutateCapability(() => addCapabilityTargetService(slot, target));
}

export async function updateAiCapabilityTarget(
  slot: string,
  targetId: string,
  target: Omit<CapabilityTargetInput, "targetId">,
) {
  return mutateCapability(() => updateCapabilityTargetService(slot, targetId, target));
}

export async function deleteAiCapabilityTarget(slot: string, targetId: string) {
  return mutateCapability(() => deleteCapabilityTargetService(slot, targetId));
}

export async function reorderAiCapabilityTargets(slot: string, orderedTargetIds: string[]) {
  return mutateCapability(() => reorderCapabilityTargetsService(slot, orderedTargetIds));
}

export async function getAiCapabilityChoices(slot: string) {
  return capabilityAction(() => listCapabilityChoicesService(slot));
}

export async function getAiCapabilityDiagnostics(input?: {
  slot?: string;
  requestId?: string;
  correlationId?: string;
  limit?: number;
}) {
  return capabilityAction(() => getCapabilityDiagnosticsService(input));
}

function buildProviderNotReadyMessage(
  displayName: string,
  connection: ProviderConnectionRow | null,
): string {
  if (!connection) {
    return `${displayName} 还没有完成连接测试。请先在 Settings → AI Tools 点击 Test Connection，测试通过后再选择。`;
  }

  const reason = getConnectionFailureReason(connection.installLog);
  if (reason) {
    return `${displayName} 最近一次 Test Connection 未通过：${reason}。请修复后重新测试，再选择为终端 Provider。`;
  }

  return `${displayName} 最近一次 Test Connection 未通过。请重新点击 Test Connection，测试通过后再选择为终端 Provider。`;
}

function getConnectionFailureReason(installLog: string | null): string | null {
  if (!installLog) return null;

  try {
    const parsed = JSON.parse(installLog) as unknown;
    if (typeof parsed !== "object" || parsed === null) return installLog;
    const report = parsed as Record<string, unknown>;
    const failedStep = ["mcp", "hooks", "skill"]
      .map((key) => [key, report[key]] as const)
      .find(([, value]) => {
        if (typeof value !== "object" || value === null) return false;
        return (value as Record<string, unknown>).ok === false;
      });
    if (!failedStep) return null;
    const [key, value] = failedStep;
    const step = key === "mcp" ? "MCP 注入" : key === "hooks" ? "Hooks 注入" : "Skill 注入";
    const error = (value as Record<string, unknown>).error;
    return typeof error === "string" && error.trim() ? `${step}失败：${error}` : `${step}失败`;
  } catch {
    return installLog;
  }
}
