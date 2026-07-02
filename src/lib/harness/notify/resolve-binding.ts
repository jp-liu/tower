import { db } from "@/lib/db";
import { readConfigValue } from "@/lib/config-reader";

export interface NotifyBinding {
  channel: string;
  target: unknown;
}

// 防环/防深链的上溯上限。
const MAX_DEPTH = 10;

/**
 * 解析一个任务的通知回流绑定（升级链）：
 * 1. 任务自身有 notifyChannel + notifyTarget → 用它；
 * 2. 否则沿 parentTaskId 向祖先链上溯，命中第一个有绑定的祖先；
 * 3. 仍无 → 落全局默认 sink（`harness.defaultSink` 配置，通常是 Tower 飞书群）；
 * 4. 都没有 → null。
 *
 * 呼应现有派生中枢「子任务向父任务回馈」的思路。malformed 的 notifyTarget 跳过该级继续上溯。
 */
export async function resolveNotifyBinding(taskId: string): Promise<NotifyBinding | null> {
  let currentId: string | null = taskId;
  let depth = 0;
  while (currentId && depth < MAX_DEPTH) {
    const t: { notifyChannel: string | null; notifyTarget: string | null; parentTaskId: string | null } | null =
      await db.task.findUnique({
        where: { id: currentId },
        select: { notifyChannel: true, notifyTarget: true, parentTaskId: true },
      });
    if (!t) break;
    if (t.notifyChannel && t.notifyTarget) {
      try {
        return { channel: t.notifyChannel, target: JSON.parse(t.notifyTarget) };
      } catch {
        // target 损坏 → 视作该级无绑定，继续上溯
      }
    }
    currentId = t.parentTaskId;
    depth++;
  }

  const sink = await readConfigValue<NotifyBinding | null>("harness.defaultSink", null);
  if (sink && sink.channel && sink.target) {
    return { channel: sink.channel, target: sink.target };
  }
  return null;
}
