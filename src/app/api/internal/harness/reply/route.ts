import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { answerHumanInputRequest, getPendingRequest } from "@/lib/harness/human-input";
import { continueOrStartTaskExecution } from "@/actions/agent-actions";

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

  await answerHumanInputRequest(taskId, text);

  // resume：PAUSED + sessionId → 续跑；已在跑则 no-op。
  await continueOrStartTaskExecution(taskId);

  // 会话拉起需数秒；等就绪后注入答案（轮询 /input 桥直到 session 活）。
  const injected = await injectWhenReady(taskId, text);
  return NextResponse.json({ ok: true, injected });
}

async function injectWhenReady(taskId: string, text: string): Promise<boolean> {
  const tid = encodeURIComponent(taskId);
  for (let i = 0; i < 20; i++) {
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
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
