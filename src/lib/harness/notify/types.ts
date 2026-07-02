/**
 * harness → 人 的平台无关消息契约。
 *
 * harness 只认这个接口，不认具体平台；adapter 负责渲染成飞书文本 / OpenClaw payload 等。
 * 新增渠道 = 实现 {@link NotifyChannel} + 注册，`ask_human` / `/harness/reply` 零改动。
 */
export type OutboundKind = "ask" | "notify" | "done" | "failed";

export interface OutboundMessage {
  /** 回流对齐用 = HarnessMessage.id（ask/notify/done/failed 均用消息行 id）。 */
  correlationId: string;
  taskId: string;
  kind: OutboundKind;
  title: string;
  body: string;
}

/** 一个发送渠道。id 唯一（"feishu" | "openclaw" | ...）。 */
export interface NotifyChannel {
  id: string;
  /** target 由调用方从 task.notifyTarget 反序列化后透传（渠道自解释其形状）。 */
  send(msg: OutboundMessage, target: unknown): Promise<{ channelRef?: string }>;
}
