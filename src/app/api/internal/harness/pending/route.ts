import { NextRequest, NextResponse } from "next/server";
import { requireLocalhost, validateTaskId } from "@/lib/internal-api-guard";
import { getOpenAsk } from "@/lib/harness/harness-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 只读：某任务当前是否有等待人回复的 PENDING 请求。
 * 供飞书 bot 分流用 —— 命中则把回复转 /harness/reply，否则走 bot 自身流程。
 */
export async function GET(request: NextRequest) {
  const blocked = requireLocalhost(request);
  if (blocked) return blocked;

  const taskId = request.nextUrl.searchParams.get("taskId") ?? "";
  const idErr = validateTaskId(taskId);
  if (idErr) return idErr;

  const pending = await getOpenAsk(taskId);
  return NextResponse.json({
    taskId,
    pending: !!pending,
    requestId: pending?.id ?? null,
    question: pending?.content ?? null,
  });
}
