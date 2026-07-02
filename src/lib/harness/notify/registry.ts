import type { NotifyChannel, OutboundMessage } from "./types";
import { logger } from "@/lib/logger";

const log = logger.create("notify-registry");

// globalThis singleton — survives Next.js HMR/module re-evaluation so a channel
// registered at startup stays visible to routes re-bundled on hot reload.
const g = globalThis as typeof globalThis & {
  __harnessChannels?: Map<string, NotifyChannel>;
};
if (!g.__harnessChannels) {
  g.__harnessChannels = new Map<string, NotifyChannel>();
}
const channels = g.__harnessChannels;

export function registerChannel(ch: NotifyChannel): void {
  channels.set(ch.id, ch);
}

export function hasChannel(id: string): boolean {
  return channels.has(id);
}

/** 仅测试用：清空注册表。 */
export function __resetChannels(): void {
  channels.clear();
}

/**
 * 把一条平台无关消息派发到指定渠道。best-effort：
 * 渠道未注册或 send 抛错都只返回 false（并 warn），绝不抛错拖累调用方主流程。
 */
export async function dispatchNotification(args: {
  channel: string;
  target: unknown;
  msg: OutboundMessage;
}): Promise<boolean> {
  const ch = channels.get(args.channel);
  if (!ch) {
    log.warn("notify dispatch skipped — channel not registered", { channel: args.channel });
    return false;
  }
  try {
    await ch.send(args.msg, args.target);
    return true;
  } catch (e) {
    log.error("notify dispatch failed", e, { channel: args.channel, kind: args.msg.kind });
    return false;
  }
}
