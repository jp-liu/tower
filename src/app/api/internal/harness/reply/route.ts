import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { answerHumanInputRequest, getPendingRequest } from "@/lib/harness/human-input";
import { continueOrStartTaskExecution } from "@/actions/agent-actions";
import { logger } from "@/lib/logger";

const log = logger.create("harness-reply");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORT = process.env.PORT ?? "3000";

/**
 * 唯一入站回复出口。渠道 adapter（飞书 bot 等）把人的回复归一化成 { taskId, text } POST 到这里。
 *
 * 流程：标 ANSWERED → resume 会话（复用 Continue 原语，already-running 为 no-op）→
 * 等 CLI TUI 就绪后把答案注入终端（轮询 /input，未就绪 404 时退避重试）。
 */
export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let body: { taskId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { taskId, text } = body;
  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  const idErr = validateTaskId(taskId);
  if (idErr) return idErr;
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const pending = await getPendingRequest(taskId);
  if (!pending) return NextResponse.json({ error: "No pending request" }, { status: 409 });

  // 把 park 时置 PAUSED 的 execution 复位为 RUNNING。这一步在 resume 之前：
  // - 若 PTY 还活着（人回复早于 stop hook fire）→ continueOrStartTaskExecution 会走
  //   already_running 分支、不碰 execution 状态；此处复位保证它日后自然退出时 onExit guard
  //   放行、能 finalize（否则永久卡 PAUSED）。
  // - 若 PTY 已被 park kill → continueLatestPtyExecution 会把 RUNNING 的旧行清成 FAILED 并
  //   新建 RUNNING 驱动，此处复位顺带消除了残留的孤儿 PAUSED 行。
  await db.taskExecution.updateMany({
    where: { taskId, status: "PAUSED" },
    data: { status: "RUNNING", endedAt: null },
  });

  // resume 先于标 ANSWERED：resume 抛错时保留 PENDING，人可经同一入口重试，不把回复"吃掉"。
  let mode: string;
  try {
    const r = await continueOrStartTaskExecution(taskId);
    mode = r.mode;
  } catch (err) {
    log.error("resume failed on reply — pending kept for retry", err, { taskId });
    return NextResponse.json({ error: "resume failed" }, { status: 500 });
  }

  await answerHumanInputRequest(taskId, text);

  // 会话拉起需数秒；等就绪后注入答案（轮询 /input 桥直到 session 活）。
  const injected = await injectWhenReady(taskId, text);
  return NextResponse.json({ ok: true, injected, mode });
}

// resume 后 PTY session 对象几乎立刻存在（/input 会马上 200），但 Claude CLI 的 TUI 需要
// 数秒才真正就绪接收输入 —— 过早写入会被丢弃。Phase 1 的缓解：先等一个启动窗口再首次注入，
// 之后再轮询兜底。真正的「会话就绪事件」回调留后续。
const INJECT_INITIAL_DELAY_MS = 2500;
const INJECT_RETRY_INTERVAL_MS = 800;
const INJECT_MAX_ATTEMPTS = 20;

async function injectWhenReady(taskId: string, text: string): Promise<boolean> {
  const tid = encodeURIComponent(taskId);
  await new Promise((r) => setTimeout(r, INJECT_INITIAL_DELAY_MS));
  for (let i = 0; i < INJECT_MAX_ATTEMPTS; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/internal/terminal/${tid}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, submit: true }),
      });
      if (res.ok) return true;
    } catch {
      // session 尚未就绪 / 桥暂不可达 → 退避重试
    }
    await new Promise((r) => setTimeout(r, INJECT_RETRY_INTERVAL_MS));
  }
  return false;
}
