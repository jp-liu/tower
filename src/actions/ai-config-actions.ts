"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { providerRegistry } from "@/lib/ai/providers";
import type { AiSlot } from "@/lib/ai/types";
import {
  getProviderConnection,
  type ProviderConnectionRow,
} from "@/actions/provider-connection-actions";

const VALID_SLOTS: AiSlot[] = ["terminal", "summary", "dreaming", "analysis", "assistant"];

export type UpdateAiCapabilityConfigResult =
  | { ok: true }
  | { ok: false; error: string };

export async function getAiCapabilityConfigs() {
  return db.aiCapabilityConfig.findMany({ orderBy: { slot: "asc" } });
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
  const connection = await getProviderConnection(data.provider);
  if (!connection?.testOk) {
    return {
      ok: false,
      error: buildProviderNotReadyMessage(providerDef.displayName, connection),
    };
  }

  await db.aiCapabilityConfig.upsert({
    where: { slot },
    create: {
      slot,
      provider: data.provider,
      mode: data.mode,
      model: data.model ?? null,
    },
    update: {
      provider: data.provider,
      mode: data.mode,
      model: data.model ?? null,
    },
  });

  revalidatePath("/settings");
  return { ok: true };
}

export async function getAvailableProviders() {
  return providerRegistry.getAvailableProviders();
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
