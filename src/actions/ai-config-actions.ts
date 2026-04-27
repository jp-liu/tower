"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { providerRegistry } from "@/lib/ai/providers";
import type { AiSlot } from "@/lib/ai/types";

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
