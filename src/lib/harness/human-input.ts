import { db } from "@/lib/db";

export interface CreateHumanInputArgs {
  taskId: string;
  executionId?: string | null;
  question: string;
}

/**
 * 记一条待人回复的请求，并把当前 RUNNING execution 置 PAUSED。
 *
 * PAUSED 是整个 park/resume 闭环的关键：进程随后被 kill 时，`agent-actions.ts` 里三处
 * onExit 回调都有 `if (currentExec?.status !== "RUNNING") return;` guard —— 已是 PAUSED
 * 就会早退，不跑总结、不转 IN_REVIEW、保留 sessionId，任务日后可 resume 续跑。
 */
export async function createHumanInputRequest(args: CreateHumanInputArgs) {
  const req = await db.humanInputRequest.create({
    data: {
      taskId: args.taskId,
      executionId: args.executionId ?? null,
      question: args.question,
    },
  });
  const paused = await db.taskExecution.updateMany({
    where: { taskId: args.taskId, status: "RUNNING" },
    data: { status: "PAUSED" },
  });
  return { requestId: req.id, execPaused: paused.count > 0 };
}

/** 该任务最新的一条 PENDING 请求（无则 null）。 */
export async function getPendingRequest(taskId: string) {
  return db.humanInputRequest.findFirst({
    where: { taskId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
}

/** 收到人的回复：把最新 PENDING 请求标 ANSWERED 并写答案。无 PENDING 返回 null。 */
export async function answerHumanInputRequest(taskId: string, answer: string) {
  const pending = await getPendingRequest(taskId);
  if (!pending) return null;
  return db.humanInputRequest.update({
    where: { id: pending.id },
    data: { status: "ANSWERED", answer, answeredAt: new Date() },
  });
}
