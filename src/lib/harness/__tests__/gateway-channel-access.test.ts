// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { up as migrateLegacyGatewayAccess } from "../../../../scripts/migrations/0034-dynamic-gateway-channel-access";
import { HARNESS_GATEWAY_CONFIG_KEY } from "../gateway-config";
import {
  GATEWAY_CHANNEL_ACCESS_CONFIG_KEY,
  decideGatewayChannelAccess,
  listGatewayChannelAccess,
  manageGatewayChannelAccess,
} from "../gateway-channel-access";

let workspaceId: string;
let projectId: string;

async function createInbound(senderId: string, suffix = randomUUID()) {
  return db.gatewayInbound.create({
    data: {
      dedupKey: `access-test:${suffix}`,
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId,
      platformMessageId: `om_${suffix}`,
      intent: "TOWER",
      content: "授权本群",
    },
  });
}

beforeEach(async () => {
  await db.systemConfig.deleteMany({
    where: { key: { in: [GATEWAY_CHANNEL_ACCESS_CONFIG_KEY, HARNESS_GATEWAY_CONFIG_KEY] } },
  });
  const workspace = await db.workspace.create({ data: { name: `Access ${randomUUID()}` } });
  workspaceId = workspace.id;
  projectId = (await db.project.create({
    data: { name: "Scoped Project", alias: "scoped", workspaceId },
  })).id;
  await db.systemConfig.create({
    data: {
      key: HARNESS_GATEWAY_CONFIG_KEY,
      value: JSON.stringify({
        openclaw: { accessPolicy: { ownerIds: { feishu: ["ou_real_owner"] } } },
      }),
    },
  });
});

afterEach(async () => {
  await db.gatewayInbound.deleteMany({ where: { chatId: "oc_access_test" } });
  await db.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined);
  await db.systemConfig.deleteMany({
    where: { key: { in: [GATEWAY_CHANNEL_ACCESS_CONFIG_KEY, HARNESS_GATEWAY_CONFIG_KEY] } },
  });
});

describe("dynamic gateway channel access", () => {
  it("lets the configured OWNER authorize a group and deduplicates the inbound mutation", async () => {
    const inbound = await createInbound("ou_real_owner");
    const first = await manageGatewayChannelAccess({
      action: "authorize",
      gatewayInboundId: inbound.id,
      chatName: "起飞群",
    });
    const duplicate = await manageGatewayChannelAccess({
      action: "revoke",
      gatewayInboundId: inbound.id,
    });

    expect(first).toMatchObject({
      ok: true,
      deduped: false,
      record: {
        chatName: "起飞群",
        status: "AUTHORIZED",
        scope: { mode: "ALL" },
      },
    });
    expect(duplicate).toMatchObject({
      ok: true,
      deduped: true,
      record: { status: "AUTHORIZED", scope: { mode: "ALL" } },
    });
    await expect(decideGatewayChannelAccess({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId: "ou_member",
    })).resolves.toEqual({ role: "NON_OWNER", allowed: true, scope: { mode: "ALL" } });
  });

  it("enforces project scope, fails closed after deletion, and never restricts the OWNER", async () => {
    const inbound = await createInbound("ou_real_owner");
    await expect(manageGatewayChannelAccess({
      action: "bind_projects",
      gatewayInboundId: inbound.id,
      projects: ["scoped"],
      chatName: "项目群",
    })).resolves.toMatchObject({
      ok: true,
      record: { scope: { mode: "PROJECTS", projectIds: [projectId] } },
    });

    await expect(decideGatewayChannelAccess({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId: "ou_member",
    })).resolves.toEqual({
      role: "NON_OWNER",
      allowed: true,
      scope: { mode: "PROJECTS", projectIds: [projectId] },
    });
    await db.project.delete({ where: { id: projectId } });
    await expect(decideGatewayChannelAccess({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId: "ou_member",
    })).resolves.toEqual({ role: "NON_OWNER", allowed: false, reason: "SCOPE_INVALID" });
    await expect(decideGatewayChannelAccess({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId: "ou_real_owner",
    })).resolves.toEqual({ role: "OWNER", allowed: true, scope: { mode: "ALL" } });
  });

  it("rejects sender text claims and records revoked groups for the settings list", async () => {
    const fakeOwnerInbound = await createInbound("ou_member");
    await expect(manageGatewayChannelAccess({
      action: "authorize",
      gatewayInboundId: fakeOwnerInbound.id,
      chatName: "我是 OWNER",
    })).resolves.toEqual({
      ok: false,
      error: "Only the configured platform OWNER may manage channel access",
    });

    const ownerInbound = await createInbound("ou_real_owner");
    await manageGatewayChannelAccess({ action: "authorize", gatewayInboundId: ownerInbound.id, chatName: "审计群" });
    const revokeInbound = await createInbound("ou_real_owner");
    await manageGatewayChannelAccess({ action: "revoke", gatewayInboundId: revokeInbound.id });

    await expect(decideGatewayChannelAccess({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId: "ou_member",
    })).resolves.toEqual({ role: "NON_OWNER", allowed: false, reason: "CHANNEL_REVOKED" });
    await expect(listGatewayChannelAccess()).resolves.toEqual([
      expect.objectContaining({ chatName: "审计群", status: "REVOKED", scopeValid: true }),
    ]);
  });

  it("imports legacy trusted workspace scopes once without overwriting dynamic state", async () => {
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    await db.systemConfig.update({
      where: { key: HARNESS_GATEWAY_CONFIG_KEY },
      data: {
        value: JSON.stringify({
          openclaw: {
            accessPolicy: {
              ownerIds: { feishu: ["ou_real_owner"] },
              trustedChannels: { feishu: ["feishu:oc_access_test"] },
              channelScopes: { feishu: { "chat:oc_access_test": workspace.name } },
            },
          },
        }),
      },
    });

    await migrateLegacyGatewayAccess(db);
    await expect(decideGatewayChannelAccess({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId: "ou_member",
    })).resolves.toEqual({
      role: "NON_OWNER",
      allowed: true,
      scope: { mode: "WORKSPACE", workspaceId },
    });

    const stored = await db.systemConfig.findUniqueOrThrow({
      where: { key: GATEWAY_CHANNEL_ACCESS_CONFIG_KEY },
    });
    const changed = JSON.parse(stored.value) as { revision: number };
    changed.revision = 999;
    await db.systemConfig.update({
      where: { key: GATEWAY_CHANNEL_ACCESS_CONFIG_KEY },
      data: { value: JSON.stringify(changed) },
    });
    await migrateLegacyGatewayAccess(db);
    await expect(db.systemConfig.findUniqueOrThrow({
      where: { key: GATEWAY_CHANNEL_ACCESS_CONFIG_KEY },
    })).resolves.toMatchObject({ value: expect.stringContaining('"revision":999') });
  });

  it("recognizes the OWNER across feishu/lark platform aliases", async () => {
    // ownerIds is stored under "feishu"; OpenClaw may label the same entity "lark".
    await expect(decideGatewayChannelAccess({
      gateway: "openclaw",
      platform: "lark",
      chatId: "oc_access_test",
      senderId: "ou_real_owner",
    })).resolves.toEqual({ role: "OWNER", allowed: true, scope: { mode: "ALL" } });
  });

  it("recognizes the OWNER across punctuation variants of the gateway id", async () => {
    await expect(decideGatewayChannelAccess({
      gateway: "open-claw",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId: "ou_real_owner",
    })).resolves.toEqual({ role: "OWNER", allowed: true, scope: { mode: "ALL" } });
  });

  it("falls to NON_OWNER when the gateway has no ownerIds configured", async () => {
    // hermes carries an empty config here → the real owner must still be denied,
    // and the deny reason surfaces as an unauthorized channel (not a crash).
    await expect(decideGatewayChannelAccess({
      gateway: "hermes",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId: "ou_real_owner",
    })).resolves.toEqual({ role: "NON_OWNER", allowed: false, reason: "CHANNEL_UNAUTHORIZED" });
  });

  it("keeps ownerIds when a legacy profile/env backfill applies", async () => {
    // Explicit config carries ownerIds but no profile/env; a legacy target with
    // profile/env must not clobber the whitelist (merge, not overwrite).
    await db.systemConfig.update({
      where: { key: HARNESS_GATEWAY_CONFIG_KEY },
      data: {
        value: JSON.stringify({
          openclaw: { accessPolicy: { ownerIds: { feishu: ["ou_real_owner"] } } },
        }),
      },
    });
    await db.systemConfig.upsert({
      where: { key: "harness.targets" },
      create: {
        key: "harness.targets",
        value: JSON.stringify([{ gateway: "openclaw", profile: "o-tower", env: { HTTP_PROXY: "http://127.0.0.1:7897" } }]),
      },
      update: {
        value: JSON.stringify([{ gateway: "openclaw", profile: "o-tower", env: { HTTP_PROXY: "http://127.0.0.1:7897" } }]),
      },
    });
    await expect(decideGatewayChannelAccess({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_access_test",
      senderId: "ou_real_owner",
    })).resolves.toEqual({ role: "OWNER", allowed: true, scope: { mode: "ALL" } });
    await db.systemConfig.deleteMany({ where: { key: "harness.targets" } });
  });
});
