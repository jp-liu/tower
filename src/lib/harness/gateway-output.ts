export interface GatewaySendMetadata {
  platform?: string;
  chat_id?: string;
  message_id?: string;
  reply_to_message_id?: string;
  msg_type?: string;
  send_mode?: "reply" | "top_level";
}

export function parseGatewaySendOutput(output: string): GatewaySendMetadata | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    const messageId =
      findStringByKeys(parsed, ["message_id", "messageId", "platformMessageId", "openMessageId"]) ??
      findStringByPattern(parsed, /^om_[A-Za-z0-9_-]+$/);
    if (!messageId) return null;
    return {
      platform: findStringByKeys(parsed, ["platform", "channel", "downstream"]),
      chat_id: findStringByKeys(parsed, ["chat_id", "chatId", "target", "to", "destination"]),
      message_id: messageId,
      reply_to_message_id: findStringByKeys(parsed, [
        "reply_to_message_id", "replyToMessageId", "replyToId", "reply_to",
      ]),
      msg_type: findStringByKeys(parsed, ["msg_type", "msgType", "message_type", "messageType"]),
      send_mode: normalizeSendMode(findStringByKeys(parsed, ["send_mode", "sendMode", "mode", "via"])),
    };
  } catch {
    const messageId =
      output.match(/\b(message_id|messageId|platformMessageId|\u98de\u4e66\u6d88\u606f\s*ID|message\s*id)\b[^A-Za-z0-9_-]*(om_[A-Za-z0-9_-]+)/i)?.[2] ??
      output.match(/\bom_[A-Za-z0-9_-]+\b/)?.[0];
    if (!messageId) return null;
    const platform = output.match(/\b(platform|channel)\b[^A-Za-z0-9_-]*([A-Za-z0-9_-]+)/i)?.[2];
    const chatId =
      output.match(/\b(chat_id|chatId|target|to)\b[^A-Za-z0-9:_-]*([A-Za-z]+:[A-Za-z0-9:_-]+)/i)?.[2] ??
      output.match(/\b(chat_id|chatId|target|to)\b[^A-Za-z0-9:_-]*(oc_[A-Za-z0-9_-]+)/i)?.[2];
    return {
      ...(platform ? { platform } : {}),
      ...(chatId ? { chat_id: chatId } : {}),
      message_id: messageId,
    };
  }
}

function normalizeSendMode(value: string | undefined): "reply" | "top_level" | undefined {
  if (!value) return undefined;
  if (/^(reply|native_reply)$/i.test(value)) return "reply";
  if (/^(top_level|direct|create)$/i.test(value)) return "top_level";
  return undefined;
}

function findStringByKeys(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringByKeys(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  for (const raw of Object.values(obj)) {
    const found = findStringByKeys(raw, keys);
    if (found) return found;
  }
  return undefined;
}

function findStringByPattern(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value === "string" && pattern.test(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const child of children) {
    const found = findStringByPattern(child, pattern);
    if (found) return found;
  }
  return undefined;
}
