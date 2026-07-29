import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { HarnessOutbound, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sendViaHarnessGateway } from "./gateway-send";
import { parseGatewaySendOutput } from "./gateway-output";

const log = logger.create("harness-outbound");
const OUTBOUND_CLAIM_LEASE_MS = 120_000;
const OUTBOUND_MAX_RETRY_DELAY_MS = 5 * 60_000;
const OUTBOUND_RECOVERY_LIMIT = 25;

export interface EnqueueHarnessOutboundInput {
  taskId: string;
  gateway: "hermes" | "openclaw";
  downstream?: string | null;
  dest?: string | null;
  requestedTo?: string | null;
  profile?: string | null;
  scope: "work" | "unattended";
  expectReply: boolean;
  message: string;
  presentation?: unknown;
  dedupKey?: string | null;
}

export interface HarnessOutboundDispatchResult {
  outboundId: string;
  state: "PENDING" | "SENDING" | "DELIVERED" | "SENT_UNVERIFIED" | "FAILED";
  deduped: boolean;
  sent: boolean;
  parked: boolean;
  platformMessageId: string | null;
  lastError: string | null;
}

function stableOutboundKey(input: EnqueueHarnessOutboundInput): string {
  if (input.dedupKey?.trim()) return `harness:${input.taskId}:${input.dedupKey.trim()}`;
  const digest = createHash("sha256")
    .update(JSON.stringify({
      taskId: input.taskId,
      gateway: input.gateway,
      downstream: input.downstream?.trim() || null,
      dest: input.dest?.trim() || null,
      requestedTo: input.requestedTo?.trim() || null,
      scope: input.scope,
      expectReply: input.expectReply,
      message: input.message.trim(),
    }))
    .digest("hex")
    .slice(0, 32);
  return `harness:${input.taskId}:${digest}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: string }).code === "P2002";
}

function parsePresentation(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function retryAt(attempts: number): Date {
  const delay = Math.min(OUTBOUND_MAX_RETRY_DELAY_MS, 2 ** Math.min(attempts, 8) * 1_000);
  return new Date(Date.now() + delay);
}

async function activateHarnessMessage(
  tx: Prisma.TransactionClient,
  outbound: HarnessOutbound,
  state: "DELIVERED" | "SENT_UNVERIFIED",
  receipt: {
    platform?: string | null;
    chatId?: string | null;
    messageId?: string | null;
    error?: string | null;
  },
): Promise<boolean> {
  if (outbound.expectReply) {
    await tx.harnessMessage.updateMany({
      where: {
        taskId: outbound.taskId,
        kind: "ask",
        state: "OPEN",
        id: { not: outbound.harnessMessageId },
      },
      data: { state: "CANCELLED" },
    });
  }
  await tx.harnessMessage.update({
    where: { id: outbound.harnessMessageId },
    data: { state: outbound.expectReply ? "OPEN" : "CLOSED" },
  });
  const paused = outbound.expectReply
    ? await tx.taskExecution.updateMany({
        where: { taskId: outbound.taskId, status: "RUNNING" },
        data: { status: "PAUSED" },
      })
    : { count: 0 };

  if (receipt.messageId) {
    const platform = receipt.platform?.trim() || outbound.downstream?.trim() || outbound.gateway;
    const chatId = receipt.chatId?.trim() || outbound.dest?.trim() || outbound.requestedTo?.trim() || "";
    await tx.harnessDelivery.upsert({
      where: { platformMessageId: receipt.messageId },
      update: {
        harnessMessageId: outbound.harnessMessageId,
        taskId: outbound.taskId,
        platform,
        chatId,
        scope: outbound.scope,
        expectReply: outbound.expectReply,
      },
      create: {
        id: `${platform}:${receipt.messageId}`,
        harnessMessageId: outbound.harnessMessageId,
        taskId: outbound.taskId,
        platform,
        chatId,
        platformMessageId: receipt.messageId,
        scope: outbound.scope,
        expectReply: outbound.expectReply,
      },
    });
  }

  await tx.harnessOutbound.update({
    where: { id: outbound.id },
    data: {
      state,
      claimToken: null,
      claimExpiresAt: null,
      platform: receipt.platform?.trim() || outbound.downstream?.trim() || outbound.gateway,
      platformChatId: receipt.chatId?.trim() || outbound.dest?.trim() || outbound.requestedTo?.trim() || null,
      platformMessageId: receipt.messageId?.trim() || null,
      deliveredAt: state === "DELIVERED" ? new Date() : null,
      nextAttemptAt: null,
      lastError: receipt.error?.slice(0, 2000) || null,
    },
  });
  return paused.count > 0;
}

async function rowResult(
  outboundId: string,
  deduped: boolean,
  parked = false,
): Promise<HarnessOutboundDispatchResult> {
  const row = await db.harnessOutbound.findUniqueOrThrow({ where: { id: outboundId } });
  return {
    outboundId,
    state: row.state,
    deduped,
    sent: row.state === "DELIVERED" || row.state === "SENT_UNVERIFIED",
    parked: parked || (row.expectReply && (row.state === "DELIVERED" || row.state === "SENT_UNVERIFIED")),
    platformMessageId: row.platformMessageId,
    lastError: row.lastError,
  };
}

export async function enqueueHarnessOutbound(
  input: EnqueueHarnessOutboundInput,
): Promise<HarnessOutboundDispatchResult> {
  const dedupKey = stableOutboundKey(input);
  let outbound: HarnessOutbound;
  let deduped = false;
  try {
    outbound = await db.$transaction(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: input.taskId },
        select: {
          id: true,
          executions: {
            where: { status: "RUNNING" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      });
      if (!task) throw new Error(`Task not found: ${input.taskId}`);
      const message = await tx.harnessMessage.create({
        data: {
          taskId: input.taskId,
          executionId: task.executions[0]?.id ?? null,
          kind: input.expectReply ? "ask" : "notify",
          content: input.message.trim(),
          state: "PENDING_DELIVERY",
        },
      });
      return tx.harnessOutbound.create({
        data: {
          dedupKey,
          taskId: input.taskId,
          executionId: task.executions[0]?.id ?? null,
          harnessMessageId: message.id,
          gateway: input.gateway,
          downstream: input.downstream?.trim() || null,
          dest: input.dest?.trim() || null,
          requestedTo: input.requestedTo?.trim() || null,
          profile: input.profile?.trim() || null,
          scope: input.scope,
          expectReply: input.expectReply,
          message: input.message.trim(),
          presentation: input.presentation === undefined ? null : JSON.stringify(input.presentation),
        },
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    outbound = await db.harnessOutbound.findUniqueOrThrow({ where: { dedupKey } });
    deduped = true;
  }
  if (outbound.state === "PENDING" || outbound.state === "FAILED") {
    return dispatchHarnessOutbound(outbound.id, deduped);
  }
  return rowResult(outbound.id, deduped);
}

export async function dispatchHarnessOutbound(
  outboundId: string,
  deduped = false,
): Promise<HarnessOutboundDispatchResult> {
  const claimToken = randomUUID();
  const claimed = await db.harnessOutbound.updateMany({
    where: {
      id: outboundId,
      state: { in: ["PENDING", "FAILED"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    data: {
      state: "SENDING",
      claimToken,
      claimExpiresAt: new Date(Date.now() + OUTBOUND_CLAIM_LEASE_MS),
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return rowResult(outboundId, deduped);
  const outbound = await db.harnessOutbound.findUniqueOrThrow({ where: { id: outboundId } });

  let sent;
  try {
    sent = await sendViaHarnessGateway({
      gateway: outbound.gateway,
      downstream: outbound.downstream,
      dest: outbound.dest,
      to: outbound.requestedTo,
      profile: outbound.profile,
      message: outbound.message,
      presentation: parsePresentation(outbound.presentation),
      scope: outbound.scope === "work" ? "work" : "unattended",
    });
  } catch (error) {
    sent = {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
      metadata: undefined,
      resolvedDest: outbound.dest,
    };
  }

  const metadata = sent.metadata ?? parseGatewaySendOutput(sent.output) ?? undefined;
  const messageId = metadata?.message_id?.trim() || null;
  if (sent.ok && messageId) {
    let parked = false;
    await db.$transaction(async (tx) => {
      const current = await tx.harnessOutbound.findUniqueOrThrow({ where: { id: outbound.id } });
      if (current.state !== "SENDING" || current.claimToken !== claimToken) return;
      parked = await activateHarnessMessage(tx, current, "DELIVERED", {
        platform: metadata?.platform,
        chatId: metadata?.chat_id || sent.resolvedDest,
        messageId,
      });
    });
    return rowResult(outbound.id, deduped, parked);
  }

  if (sent.ok || messageId) {
    let parked = false;
    await db.$transaction(async (tx) => {
      const current = await tx.harnessOutbound.findUniqueOrThrow({ where: { id: outbound.id } });
      if (current.state !== "SENDING" || current.claimToken !== claimToken) return;
      parked = await activateHarnessMessage(tx, current, "SENT_UNVERIFIED", {
        platform: metadata?.platform,
        chatId: metadata?.chat_id || sent.resolvedDest,
        messageId,
        error: sent.ok
          ? "Gateway reported success without a verifiable platform message id; automatic retry disabled"
          : `Platform may have accepted the message before failure: ${sent.output}`,
      });
    });
    return rowResult(outbound.id, deduped, parked);
  }

  await db.harnessOutbound.updateMany({
    where: { id: outbound.id, state: "SENDING", claimToken },
    data: {
      state: "FAILED",
      claimToken: null,
      claimExpiresAt: null,
      nextAttemptAt: retryAt(outbound.attempts),
      lastError: sent.output.slice(0, 2000),
    },
  });
  return rowResult(outbound.id, deduped);
}

export async function recoverHarnessOutbounds(): Promise<{
  staleUnverified: number;
  retried: number;
}> {
  const now = new Date();
  const stale = await db.harnessOutbound.findMany({
    where: { state: "SENDING", claimExpiresAt: { lt: now } },
    orderBy: { createdAt: "asc" },
    take: OUTBOUND_RECOVERY_LIMIT,
  });
  let staleUnverified = 0;
  for (const outbound of stale) {
    let recovered = false;
    await db.$transaction(async (tx) => {
      const current = await tx.harnessOutbound.findUniqueOrThrow({ where: { id: outbound.id } });
      if (current.state !== "SENDING" || !current.claimExpiresAt || current.claimExpiresAt >= now) return;
      await activateHarnessMessage(tx, current, "SENT_UNVERIFIED", {
        error: "Sender crashed with an in-flight platform request; automatic retry disabled",
      });
      recovered = true;
    });
    if (recovered) staleUnverified++;
  }

  const due = await db.harnessOutbound.findMany({
    where: {
      state: { in: ["PENDING", "FAILED"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: OUTBOUND_RECOVERY_LIMIT,
    select: { id: true },
  });
  for (const outbound of due) {
    await dispatchHarnessOutbound(outbound.id).catch((error) => {
      log.warn("Durable harness outbound retry failed", {
        outboundId: outbound.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return { staleUnverified, retried: due.length };
}
