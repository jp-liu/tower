"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { providerRegistry } from "@/lib/ai/providers";
import type { AiSlot } from "@/lib/ai/types";
import { isProviderConnected } from "@/actions/provider-connection-actions";

const VALID_SLOTS: AiSlot[] = ["terminal", "summary", "dreaming", "analysis", "assistant"];

export async function getAiCapabilityConfigs() {
  return db.aiCapabilityConfig.findMany({ orderBy: { slot: "asc" } });
}

export async function updateAiCapabilityConfig(
  slot: string,
  data: { provider: string; mode: string; model?: string | null }
) {
  if (!VALID_SLOTS.includes(slot as AiSlot)) {
    throw new Error(`无效的插槽: ${slot}`);
  }

  const providerDef = providerRegistry.get(data.provider);
  if (!providerDef) {
    throw new Error(`未知的 Provider: ${data.provider}`);
  }

  if (slot === "terminal" && data.mode !== "cli") {
    throw new Error("终端执行只支持 CLI 模式");
  }

  // Gate: capability slots can only point at providers that finished test +
  // install. Untested → we don't know if MCP/hooks/skill are actually wired.
  // See .notes/ai-provider-integration.md.
  if (!(await isProviderConnected(data.provider))) {
    throw new Error(
      `Provider "${data.provider}" 未连接或集成未注入完整 — 请到 Settings → Test Connection 测试通过后再选`,
    );
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
}

export async function getAvailableProviders() {
  return providerRegistry.getAvailableProviders();
}
