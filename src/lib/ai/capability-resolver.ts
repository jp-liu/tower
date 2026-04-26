import { db } from "@/lib/db";
import { providerRegistry } from "./providers";
import { AiProviderError } from "./types";
import type { CliAdapter, AiQueryAdapter, ProviderDefinition, AiSlot } from "./types";

const DEFAULT_PROVIDER = "claude";
const DEFAULT_MODE = "cli";

interface ResolvedCliAdapter {
  adapter: CliAdapter;
  provider: ProviderDefinition;
  model?: string;
}

interface ResolvedQueryAdapter {
  adapter: AiQueryAdapter;
  provider: ProviderDefinition;
  model?: string;
}

async function loadSlotConfig(slot: AiSlot) {
  return db.aiCapabilityConfig.findUnique({ where: { slot } });
}

export async function resolveCliAdapter(slot: "terminal"): Promise<ResolvedCliAdapter> {
  const config = await loadSlotConfig(slot);
  const providerName = config?.provider ?? DEFAULT_PROVIDER;
  const model = config?.model ?? undefined;

  const providerDef = providerRegistry.get(providerName);
  if (!providerDef) {
    throw new AiProviderError("CLI_NOT_FOUND", providerName, `Provider "${providerName}" 未注册`);
  }

  const adapter = providerDef.cli?.adapter;
  if (!adapter) {
    throw new AiProviderError(
      "UNSUPPORTED_MODE",
      providerName,
      `Provider "${providerName}" 不支持 CLI 模式`
    );
  }

  return { adapter, provider: providerDef, model };
}

export async function resolveQueryAdapter(
  slot: "summary" | "dreaming" | "analysis" | "assistant"
): Promise<ResolvedQueryAdapter> {
  const config = await loadSlotConfig(slot);
  const providerName = config?.provider ?? DEFAULT_PROVIDER;
  const mode = config?.mode ?? DEFAULT_MODE;
  const model = config?.model ?? undefined;

  const providerDef = providerRegistry.get(providerName);
  if (!providerDef) {
    throw new AiProviderError("CLI_NOT_FOUND", providerName, `Provider "${providerName}" 未注册`);
  }

  const adapter = providerRegistry.getQueryAdapter(providerName, mode as "api" | "cli");
  if (!adapter) {
    throw new AiProviderError(
      "UNSUPPORTED_MODE",
      providerName,
      `Provider "${providerName}" 不支持 ${mode} 查询模式`
    );
  }

  if (model) {
    const availableModels = providerDef.models[mode as "cli" | "api"] ?? [];
    if (availableModels.length > 0 && !availableModels.includes(model)) {
      throw new AiProviderError(
        "MODEL_NOT_AVAILABLE",
        providerName,
        `模型 "${model}" 在 ${providerName} ${mode} 模式下不可用`
      );
    }
  }

  return { adapter, provider: providerDef, model };
}
