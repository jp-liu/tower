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

