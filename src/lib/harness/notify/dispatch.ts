import { readConfigValue } from "@/lib/config-reader";
import { ensureNotifyChannels } from "./init";
import { dispatchNotification } from "./registry";
import { resolveNotifyBinding } from "./resolve-binding";
import type { OutboundKind } from "./types";

export interface NotifyResult {
  notified: boolean;
  reason?: string;
}

/**
 * 统一的对人派发闸门 —— ask / notify / done / failed 都经这里。
 *
 * 门禁：`unattended` 关 → 不推（仅 UI 可见）；全局 `harness.dnd` 开 → 一律不推。
 * 通过后按升级链解析绑定（自身 → 祖先 → 默认 sink）并派发。全程 best-effort，返回是否推成。
 */
export async function notifyForTask(args: {
  taskId: string;
  unattended: boolean;
  kind: OutboundKind;
  title: string;
  body: string;
  correlationId: string;
}): Promise<NotifyResult> {
  if (!args.unattended) return { notified: false, reason: "not_unattended" };

  const dnd = await readConfigValue<boolean>("harness.dnd", false);
  if (dnd) return { notified: false, reason: "dnd" };

  await ensureNotifyChannels();
  const binding = await resolveNotifyBinding(args.taskId);
  if (!binding) return { notified: false, reason: "no_binding" };

  const ok = await dispatchNotification({
    channel: binding.channel,
    target: binding.target,
    msg: {
      correlationId: args.correlationId,
      taskId: args.taskId,
      kind: args.kind,
      title: args.title,
      body: args.body,
    },
  });
  return { notified: ok, reason: ok ? undefined : "dispatch_failed" };
}
