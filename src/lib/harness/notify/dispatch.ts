import { db } from "@/lib/db";
import { readConfigValue } from "@/lib/config-reader";
import { ensureNotifyChannels } from "./init";
import { dispatchNotification } from "./registry";
import { resolveNotifyBinding, type NotifyBinding } from "./resolve-binding";
import { recordHarnessMessage, markNotifyStatus } from "../harness-message";
import { logger } from "@/lib/logger";
import type { OutboundKind } from "./types";

const log = logger.create("notify-dispatch");

// 发送重试退避（3 次）。测试可经 opts.retryDelaysMs 传 [0,0,0] 免等。
const RETRY_DELAYS_MS = [500, 1500, 3000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface NotifyResult {
  notified: boolean;
  reason?: string;
}

/** feishu 类 locator：优先 threadId，回退 chatId。用于反查键与 targetRef。 */
function locatorOf(target: unknown): string | null {
  const t = target as { threadId?: string; chatId?: string } | null;
  return t?.threadId || t?.chatId || null;
}

/** 出站成功后写任务反查键 `<channel>:<locator>`，供 /reply 用 {channel,locator} 反查 taskId。best-effort。 */
async function writeNotifyThreadRef(taskId: string, binding: NotifyBinding): Promise<void> {
  const locator = locatorOf(binding.target);
  if (!locator) return;
  const ref = `${binding.channel}:${locator}`;
  try {
    await db.task.update({ where: { id: taskId }, data: { notifyThreadRef: ref } });
  } catch {
    // best-effort — 反查键写失败不影响发送
  }
}

/**
 * 派发一条**已记录**的 HarnessMessage 到人（ask/notify/done/failed 通用）。
 *
 * 门禁：`unattended` 关 → 不推（记录仍在，UI 可见）；全局 `harness.dnd` 开 → 一律不推。
 * 通过后按升级链解析绑定（自身→祖先→默认 sink），发送失败退避重试 3 次，最终把 notifyStatus
 * 标 SENT/FAILED（与 state 解耦：FAILED 不改 state，UI 仍可见并可重发）。
 *
 * **全程 best-effort：绝不抛错。** 关键在于记录（park/日志）已落库，通知推没推成都不能反过来
 * 让 /ask 等调用方 500（否则 agent 收 error 可能不停、重复 ask）。
 */
export async function dispatchHarnessMessage(
  args: {
    messageId: string;
    taskId: string;
    unattended: boolean;
    kind: OutboundKind;
    title: string;
    body: string;
  },
  opts?: { retryDelaysMs?: number[] }
): Promise<NotifyResult> {
  if (!args.unattended) return { notified: false, reason: "not_unattended" };

  try {
    const dnd = await readConfigValue<boolean>("harness.dnd", false);
    if (dnd) return { notified: false, reason: "dnd" };

    await ensureNotifyChannels();
    const binding = await resolveNotifyBinding(args.taskId);
    if (!binding) {
      await markNotifyStatus(args.messageId, "FAILED");
      return { notified: false, reason: "no_binding" };
    }

    const delays = opts?.retryDelaysMs ?? RETRY_DELAYS_MS;
    const targetRef = JSON.stringify(binding.target);
    let ok = false;
    for (let attempt = 0; attempt < delays.length; attempt++) {
      ok = await dispatchNotification({
        channel: binding.channel,
        target: binding.target,
        msg: {
          correlationId: args.messageId,
          taskId: args.taskId,
          kind: args.kind,
          title: args.title,
          body: args.body,
        },
      });
      if (ok) break;
      if (attempt < delays.length - 1) await sleep(delays[attempt]);
    }

    if (ok) {
      await markNotifyStatus(args.messageId, "SENT", { channel: binding.channel, targetRef });
      await writeNotifyThreadRef(args.taskId, binding);
      return { notified: true };
    }
    await markNotifyStatus(args.messageId, "FAILED", { channel: binding.channel, targetRef });
    return { notified: false, reason: "dispatch_failed" };
  } catch (e) {
    log.error("dispatchHarnessMessage failed (swallowed — record path must not break)", e, {
      taskId: args.taskId,
      kind: args.kind,
    });
    try {
      await markNotifyStatus(args.messageId, "FAILED");
    } catch {
      /* ignore */
    }
    return { notified: false, reason: "error" };
  }
}

/** 重发一条已记录的消息（通知中心「重发」按钮用）。按当前绑定重新投递并刷新 notifyStatus。 */
export async function resendHarnessMessage(messageId: string): Promise<NotifyResult> {
  const row = await db.harnessMessage.findUnique({
    where: { id: messageId },
    include: { task: { select: { title: true, unattended: true } } },
  });
  if (!row) return { notified: false, reason: "not_found" };
  return dispatchHarnessMessage({
    messageId: row.id,
    taskId: row.taskId,
    unattended: row.task.unattended,
    kind: row.kind as OutboundKind,
    title: row.task.title,
    body: row.content,
  });
}

/**
 * 记录 + 派发一条 notify/done/failed 日志消息（一步到位）。ask 不走这里 —— 它要先 park、
 * 走 {@link createAskMessage} + 单独 {@link dispatchHarnessMessage}。
 */
export async function emitHarnessMessage(
  args: {
    taskId: string;
    executionId?: string | null;
    unattended: boolean;
    kind: Exclude<OutboundKind, "ask">;
    title: string;
    body: string;
  },
  opts?: { retryDelaysMs?: number[] }
): Promise<{ messageId: string; notified: boolean }> {
  const { messageId } = await recordHarnessMessage({
    taskId: args.taskId,
    executionId: args.executionId ?? null,
    kind: args.kind,
    content: args.body,
  });
  const { notified } = await dispatchHarnessMessage(
    {
      messageId,
      taskId: args.taskId,
      unattended: args.unattended,
      kind: args.kind,
      title: args.title,
      body: args.body,
    },
    opts
  );
  return { messageId, notified };
}
