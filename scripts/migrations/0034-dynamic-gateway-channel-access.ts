import type { PrismaClient } from "@prisma/client";

const ACCESS_KEY = "tower-agent.channel-access.v1";
const LEGACY_GATEWAY_KEY = "harness.gatewayConfig";
const LEGACY_BINDINGS_KEY = "harness.channelBindings";

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeChatId(value: unknown): string {
  return normalize(value)
    .replace(/^(?:feishu|lark|wechat|weixin):/, "")
    .replace(/^chat:/, "");
}

function channelKey(gateway: string, platform: string, chatId: string): string {
  return JSON.stringify([normalize(gateway), normalize(platform), normalizeChatId(chatId)]);
}

function parseJson(value: string | undefined): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

/**
 * One-time compatibility import. Dynamic state wins permanently: if the new
 * versioned config already exists, this migration does not merge or overwrite it.
 */
export async function up(prisma: PrismaClient) {
  const existing = await prisma.systemConfig.findUnique({ where: { key: ACCESS_KEY }, select: { id: true } });
  if (existing) return;

  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: [LEGACY_GATEWAY_KEY, LEGACY_BINDINGS_KEY] } },
    select: { key: true, value: true },
  });
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const gatewayConfig = parseJson(values[LEGACY_GATEWAY_KEY]);
  const bindingsValue = parseJson(values[LEGACY_BINDINGS_KEY]);
  const bindings = Array.isArray(bindingsValue) ? bindingsValue : [];
  const channels: Record<string, unknown> = {};
  const now = new Date().toISOString();

  if (gatewayConfig && typeof gatewayConfig === "object" && !Array.isArray(gatewayConfig)) {
    for (const [gateway, runtimeValue] of Object.entries(gatewayConfig as Record<string, unknown>)) {
      if (!runtimeValue || typeof runtimeValue !== "object" || Array.isArray(runtimeValue)) continue;
      const policy = (runtimeValue as Record<string, unknown>).accessPolicy;
      if (!policy || typeof policy !== "object" || Array.isArray(policy)) continue;
      const trustedChannels = (policy as Record<string, unknown>).trustedChannels;
      const channelScopes = (policy as Record<string, unknown>).channelScopes;
      if (!trustedChannels || typeof trustedChannels !== "object" || Array.isArray(trustedChannels)) continue;

      for (const [platform, idsValue] of Object.entries(trustedChannels as Record<string, unknown>)) {
        if (!Array.isArray(idsValue)) continue;
        for (const rawId of idsValue) {
          if (typeof rawId !== "string" || !rawId.trim()) continue;
          const chatId = normalizeChatId(rawId);
          let scope: { mode: "ALL" } | { mode: "WORKSPACE"; workspaceId: string } | {
            mode: "PROJECTS";
            projectIds: string[];
          } = { mode: "ALL" };

          const explicitBinding = bindings.find((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return false;
            const binding = value as Record<string, unknown>;
            return (!binding.gateway || normalize(binding.gateway) === normalize(gateway))
              && normalize(binding.platform) === normalize(platform)
              && normalizeChatId(binding.chatId) === chatId;
          }) as Record<string, unknown> | undefined;
          const projectIds = Array.isArray(explicitBinding?.allowedProjectIds)
            ? [...new Set(explicitBinding.allowedProjectIds
                .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
                .map((item) => item.trim()))]
            : [];
          if (projectIds.length > 0) {
            const count = await prisma.project.count({ where: { id: { in: projectIds } } });
            if (count === projectIds.length) scope = { mode: "PROJECTS", projectIds };
          } else {
            const configuredWorkspace = typeof explicitBinding?.defaultWorkspaceId === "string"
              ? explicitBinding.defaultWorkspaceId.trim()
              : (() => {
                  if (!channelScopes || typeof channelScopes !== "object" || Array.isArray(channelScopes)) return "";
                  const platformScopes = Object.entries(channelScopes as Record<string, unknown>)
                    .find(([key]) => normalize(key) === normalize(platform))?.[1];
                  if (!platformScopes || typeof platformScopes !== "object" || Array.isArray(platformScopes)) return "";
                  const raw = Object.entries(platformScopes as Record<string, unknown>)
                    .find(([key]) => normalizeChatId(key) === chatId)?.[1];
                  return typeof raw === "string" ? raw.trim() : "";
                })();
            if (configuredWorkspace) {
              const workspaces = await prisma.workspace.findMany({
                where: { OR: [{ id: configuredWorkspace }, { name: configuredWorkspace }] },
                take: 2,
                select: { id: true },
              });
              if (workspaces.length === 1) scope = { mode: "WORKSPACE", workspaceId: workspaces[0].id };
            }
          }

          const record = {
            gateway: normalize(gateway),
            platform: normalize(platform),
            chatId,
            status: "AUTHORIZED",
            scope,
            authorizedBy: "legacy-config-migration",
            authorizedAt: now,
            updatedBy: "legacy-config-migration",
            updatedAt: now,
            revision: 1,
          };
          channels[channelKey(gateway, platform, chatId)] = record;
        }
      }
    }
  }

  await prisma.systemConfig.create({
    data: {
      key: ACCESS_KEY,
      value: JSON.stringify({
        version: 1,
        revision: Object.keys(channels).length,
        channels,
        mutationReceipts: {},
      }),
    },
  });
}
