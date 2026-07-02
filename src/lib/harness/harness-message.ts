import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/** harness→人 消息的种类。ask 参与 park/resume 生命周期；其余是纯日志行。 */
export type OutboundKind = "ask" | "notify" | "done" | "failed";

export type HarnessState =
  | "OPEN"
  | "ANSWERED"
  | "CANCELLED"
  | "IGNORED"
  | "EXPIRED"
  | "CLOSED";

/**
 * 记一条 harness→人 的消息（纯记录，Tower 不发送）。state 由 kind 决定：ask 出生 OPEN
 * （进入 park/resume 生命周期），notify/done/failed 出生即 CLOSED（纯日志行，不参与「待回复」过滤）。
 */
export async function recordHarnessMessage(args: {
  taskId: string;
  executionId?: string | null;
  kind: OutboundKind;
  content: string;
}): Promise<{ messageId: string }> {
  const state: HarnessState = args.kind === "ask" ? "OPEN" : "CLOSED";
  const row = await db.harnessMessage.create({
    data: {
      taskId: args.taskId,
      executionId: args.executionId ?? null,
      kind: args.kind,
      content: args.content,
      state,
    },
  });
  return { messageId: row.id };
}

/**
 * ask 专用：先取消该任务旧的 OPEN ask（one-pending-per-task —— 新问题覆盖旧的），
 * 再记录一条 ask(OPEN) 并把 RUNNING execution 置 PAUSED（park）。
 */
export async function createAskMessage(args: {
  taskId: string;
  executionId?: string | null;
  question: string;
}): Promise<{ messageId: string; execPaused: boolean }> {
  await cancelOpenAsks(args.taskId);
  const { messageId } = await recordHarnessMessage({
    taskId: args.taskId,
    executionId: args.executionId ?? null,
    kind: "ask",
    content: args.question,
  });
  const paused = await db.taskExecution.updateMany({
    where: { taskId: args.taskId, status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  return { messageId, execPaused: paused.count > 0 };
}

/** 该任务当前待回复的 ask（kind=ask AND state=OPEN 最新）；无则 null。 */
export async function getOpenAsk(taskId: string) {
  return db.harnessMessage.findFirst({
    where: { taskId, kind: "ask", state: "OPEN" },
    orderBy: { createdAt: "desc" },
  });
}

/** 该任务最新的一条 ask（任意 state）；用于 /reply 判断是否「已回复待重试」。 */
export async function getLatestAsk(taskId: string) {
  return db.harnessMessage.findFirst({
    where: { taskId, kind: "ask" },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * 幂等应答：用 updateMany 原子地把 OPEN 的 ask 置 ANSWERED（SQLite 写串行化 → 并发回复
 * 只有第一条 count=1 生效，其余 count=0）。count=0 返回 null（无 OPEN 可答）。
 */
export async function answerOpenAsk(taskId: string, replyText: string) {
  const res = await db.harnessMessage.updateMany({
    where: { taskId, kind: "ask", state: "OPEN" },
    data: { state: "ANSWERED", replyText, repliedAt: new Date() },
  });
  if (res.count === 0) return null;
  return getLatestAsk(taskId);
}

/** UI「忽略」：只对仍 OPEN 的 ask 生效 → IGNORED。 */
export async function ignoreAsk(messageId: string): Promise<boolean> {
  const res = await db.harnessMessage.updateMany({
    where: { id: messageId, kind: "ask", state: "OPEN" },
    data: { state: "IGNORED" },
  });
  return res.count > 0;
}

/** 清理触发（stop/重启/删除等）：把该任务所有 OPEN ask 置 CANCELLED，返回数量。 */
export async function cancelOpenAsks(taskId: string): Promise<number> {
  const res = await db.harnessMessage.updateMany({
    where: { taskId, kind: "ask", state: "OPEN" },
    data: { state: "CANCELLED" },
  });
  return res.count;
}

/** UI「dismiss」：删除一条 info（notify/done/failed）日志行。 */
export async function dismissMessage(messageId: string): Promise<void> {
  await db.harnessMessage.delete({ where: { id: messageId } });
}

/** TTL 兜底 sweep：超过 ttlDays 仍 OPEN 的 ask → EXPIRED，返回数量。 */
export async function sweepExpiredAsks(ttlDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
  const res = await db.harnessMessage.updateMany({
    where: { kind: "ask", state: "OPEN", createdAt: { lt: cutoff } },
    data: { state: "EXPIRED" },
  });
  return res.count;
}

export interface ListHarnessFilter {
  /** "pending" = 待回复; "answered" = 已回复; "all" = 全部 */
  view?: "pending" | "answered" | "all";
  limit?: number;
}

/** 通知中心读取：按视图过滤，待回复优先（OPEN ask 置顶）+ 时间倒序。 */
export async function listHarnessMessages(filter: ListHarnessFilter = {}) {
  const view = filter.view ?? "pending";
  const where: Prisma.HarnessMessageWhereInput =
    view === "pending"
      ? { kind: "ask", state: "OPEN" }
      : view === "answered"
        ? { kind: "ask", state: "ANSWERED" }
        : {};
  return db.harnessMessage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 200,
    include: { task: { select: { id: true, title: true } } },
  });
}
