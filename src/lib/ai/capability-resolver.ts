import { db } from "@/lib/db";
import { providerRegistry } from "./providers";
import { AiProviderError } from "./types";
import type { CliAdapter, AiQueryAdapter, ProviderDefinition, AiSlot } from "./types";
import {
  isProviderConnected,
  getConnectedProviders,
} from "@/actions/provider-connection-actions";

const DEFAULT_PROVIDER = "claude";
const DEFAULT_MODE = "cli";

const NOT_CONNECTED_HINT =
  "请到 Settings → Test Connection 测试该 Provider 后再使用（未注入的 CLI 不能被插槽选中）";

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

/**
 * Decide which provider to actually use for a slot.
 *
 * Rules (added in Batch 2 — see .notes/ai-provider-integration.md):
 *   1. If the slot has a configured provider, REQUIRE that provider be
 *      connected. Don't silently fall back — that would hide misconfiguration.
 *   2. If the slot has no config, fall back to the default IF it's connected.
 *      Otherwise pick the first other connected provider.
 *   3. If nothing is connected, throw with a clear pointer to Test Connection.
 *
 * Untested or partially-installed providers are intentionally invisible here:
 * we don't know that their hooks/MCP/skills landed correctly without a probe.
 */
async function resolveProviderName(configuredProvider: string | null): Promise<string> {
  if (configuredProvider) {
    if (await isProviderConnected(configuredProvider)) return configuredProvider;
    throw new AiProviderError(
      "CLI_NOT_FOUND",
      configuredProvider,
      `Provider "${configuredProvider}" 未连接：${NOT_CONNECTED_HINT}`,
    );
  }

  const connected = await getConnectedProviders();
  if (connected.length === 0) {
    throw new AiProviderError(
      "CLI_NOT_FOUND",
      DEFAULT_PROVIDER,
      `没有任何 AI Provider 已连接：${NOT_CONNECTED_HINT}`,
    );
  }
  return connected.includes(DEFAULT_PROVIDER) ? DEFAULT_PROVIDER : connected[0];
}

export async function resolveCliAdapter(slot: "terminal"): Promise<ResolvedCliAdapter> {
  const config = await loadSlotConfig(slot);
  const model = config?.model ?? undefined;

  const providerName = await resolveProviderName(config?.provider ?? null);

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
  const mode = config?.mode ?? DEFAULT_MODE;
  const model = config?.model ?? undefined;

  const providerName = await resolveProviderName(config?.provider ?? null);

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
