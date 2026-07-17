import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { db } from "@/lib/db";
import { getOpenAsk, getLatestAsk, answerOpenAsk } from "@/lib/harness/harness-message";
import { continueOrStartTaskExecution } from "@/actions/agent-actions";
import { unparkSession } from "@/lib/pty/session-store";
import { logger } from "@/lib/logger";

const log = logger.create("harness-reply");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PORT = process.env.PORT ?? "3000";

/**
 * 入站回复出口。bridge（bot / OpenClaw…，经 reply_to_ask 工具）或通知中心页面把人的回复
 * 带上 taskId POST 到这里。归属由调用方给 taskId —— Tower 不存「平台线程↔任务」绑定，
 * 那张映射表在 bridge 侧（靠出站消息里的 [[tower:task=<id>]] 口令维护）。
 *
 * 流程：定位 OPEN ask → 幂等应答（并发只第一条生效）→ 复位 PAUSED→RUNNING → resume（复用
 * Continue 原语）→ 等就绪后注入答案（fresh start 时带上原问题上下文）。
 */
export async function POST(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  let body: { taskId?: string; text?: string; allowRetry?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // allowRetry：无 OPEN ask 但最近一条已 ANSWERED 时，是否把本次当「resume 重试」再注入一遍。
  // 应用内回复(UI)默认 true；bridge(reply_to_ask)传 false —— 答后的新消息应作普通消息处理，别误重发。
  const allowRetry = body.allowRetry !== false;

  const { text } = body;
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  if (!body.taskId) {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }
  const idErr = validateTaskId(body.taskId);
  if (idErr) return idErr;
  const taskId = body.taskId;

  // ── 定位 OPEN ask + 幂等应答 ──
  let question: string | null = null;
  const open = await getOpenAsk(taskId);
  if (open) {
    const answered = await answerOpenAsk(taskId, text);
    if (!answered) {
      // 并发回复：另一条已抢先应答并在 resume，本条去重返回，避免二次注入。
      return NextResponse.json({ ok: true, deduped: true });
    }
    question = open.content;
  } else {
    // 无 OPEN ask：可能是「已应答但 resume 未完成」的重试，或回复落到非 ask（不当答案）。
    // bridge(allowRetry=false)：不做重试 —— 答后的消息一律当无待回复(409)，交调用方按普通消息处理。
    const latest = await getLatestAsk(taskId);
    if (!allowRetry || !latest || latest.state !== "ANSWERED") {
      return NextResponse.json({ error: "No open ask for this task" }, { status: 409 });
    }
    question = latest.content; // resume 重试：带回原问题上下文
  }

  // 复位 park 时的 PAUSED execution → RUNNING：保证即便 resume 走 already_running 分支，
  // 该 execution 日后自然退出时 onExit guard 也放行、能 finalize（否则永久卡 PAUSED）。
  await db.taskExecution.updateMany({
    where: { taskId, status: "PAUSED" },
    data: { status: "RUNNING", endedAt: null },
  });

  // resume 先于「消费」：resume 抛错时 ask 已是 ANSWERED，人可经同一入口重试（走上面的 resume 重试分支）。
  let mode: string;
  try {
    const r = await continueOrStartTaskExecution(taskId);
    mode = r.mode;
  } catch (err) {
    log.error("resume failed on reply — ask kept ANSWERED for retry", err, { taskId });
    return NextResponse.json({ error: "resume failed" }, { status: 500 });
  }

  // Reply consumed → clear parked so normal keepalive resumes on the next disconnect.
  unparkSession(taskId);

  // fresh start（无历史会话可续）时，新 agent 不知道在答什么 → 注入答案带上原问题上下文。
  const injectText =
    mode === "started" && question ? `[针对你之前的提问：${question}]\n${text}` : text;

  // already_running = live parked terminal, TUI already ready → inject immediately;
  // the 2500ms startup window is only needed after a resume/fresh-start restart.
  const injected = await injectWhenReady(taskId, injectText, mode === "already_running");
  return NextResponse.json({ ok: true, taskId, mode, injected });
}

// resume 后 PTY session 对象几乎立刻存在（/input 会马上 200），但 Claude CLI 的 TUI 需要
// 数秒才真正就绪接收输入 —— 过早写入会被丢弃。Phase 1 的缓解：先等一个启动窗口再首次注入，
// 之后再轮询兜底。真正的「会话就绪事件」回调留后续。
const INJECT_INITIAL_DELAY_MS = 2500;
const INJECT_RETRY_INTERVAL_MS = 800;
const INJECT_MAX_ATTEMPTS = 20;

async function injectWhenReady(taskId: string, text: string, skipInitialDelay = false): Promise<boolean> {
  const tid = encodeURIComponent(taskId);
  if (!skipInitialDelay) await new Promise((r) => setTimeout(r, INJECT_INITIAL_DELAY_MS));
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
