"use server";

import { revalidatePath } from "next/cache";
import {
  listHarnessMessages,
  ignoreAsk,
  dismissMessage,
  type ListHarnessFilter,
} from "@/lib/harness/harness-message";

export type HarnessView = "pending" | "answered" | "all";

export interface HarnessMessageView {
  id: string;
  taskId: string;
  taskTitle: string;
  kind: string;
  content: string;
  state: string;
  replyText: string | null;
  repliedAt: string | null;
  createdAt: string;
}

/** 通知中心读取：按视图过滤，待回复优先 + 时间倒序，映射为可序列化形状。 */
export async function getHarnessMessages(view: HarnessView = "pending"): Promise<HarnessMessageView[]> {
  const rows = await listHarnessMessages({ view } as ListHarnessFilter);
  return rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    taskTitle: r.task?.title ?? "",
    kind: r.kind,
    content: r.content,
    state: r.state,
    replyText: r.replyText,
    repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** 行内回复 OPEN ask —— 复用唯一入站路由 /harness/reply（应答 + resume + 注入）。 */
export async function replyHarnessAsk(
  taskId: string,
  text: string
): Promise<{ ok: boolean; error?: string; mode?: string; injected?: boolean }> {
  const port = process.env.PORT ?? "3000";
  try {
    const res = await fetch(`http://localhost:${port}/api/internal/harness/reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId, text }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    revalidatePath("/harness");
    if (!res.ok) return { ok: false, error: (data.error as string) ?? "reply failed" };
    return { ok: true, mode: data.mode as string | undefined, injected: data.injected as boolean | undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 连通性测试：拉起一个 headless `claude --print` 在数据目录（dev=~/.tower-dev）里，用对应网关的
 * 平台 MCP **真发一条测试消息**给指定目的地。best-effort —— 能否发通取决于用户是否配好了平台 MCP，
 * 这正是"测试"要暴露的。返回 agent 的输出，SENT 视为成功。
 */
export async function testHarnessTarget(input: {
  gateway: string;
  downstream: string;
  dest: string;
}): Promise<{ ok: boolean; output: string }> {
  const dest = input.dest?.trim();
  if (!dest) return { ok: false, output: "缺少测试目的地" };

  const { getTowerDir } = await import("@/lib/tower-dir");
  const { resolveCommandPathSync } = await import("@/lib/platform");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const via = input.downstream ? `通过「${input.downstream}」` : "";
  const prompt =
    `这是一次通知渠道连通性测试。请用「${input.gateway}」网关${via}，` +
    `给「${dest}」发送一条测试消息：「✅ Tower 通知渠道测试，收到请忽略」。` +
    `收件人「${dest}」可能是名称而非 id（如某个人名或群名）—— ` +
    `若不是现成 id，先用对应平台的 MCP 工具按名称查找该群/人拿到 id，再发送。` +
    `只做这一件事。发送成功只回复 SENT，失败只回复 FAILED 加简短原因。`;

  const cmd = process.env.CLAUDE_CODE_PATH || resolveCommandPathSync("claude");
  try {
    const { stdout } = await execFileAsync(
      cmd,
      // bypassPermissions：headless 下让 agent 能直接调用平台 MCP 工具真发（否则会卡在权限确认）。
      ["--print", prompt, "--permission-mode", "bypassPermissions"],
      { cwd: getTowerDir(), timeout: 120_000, maxBuffer: 1024 * 1024, env: process.env }
    );
    const out = (stdout || "").trim();
    return { ok: /\bSENT\b/i.test(out), output: out || "（无输出）" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const out = (err.stdout || err.stderr || err.message || String(e)).trim();
    return { ok: false, output: out.slice(0, 2000) };
  }
}

export async function ignoreHarnessAsk(messageId: string): Promise<{ ok: boolean }> {
  const ok = await ignoreAsk(messageId);
  revalidatePath("/harness");
  return { ok };
}

export async function dismissHarnessMessage(messageId: string): Promise<{ ok: boolean }> {
  await dismissMessage(messageId);
  revalidatePath("/harness");
  return { ok: true };
}

