import type { NotifyChannel, OutboundMessage, OutboundKind } from "./types";

/**
 * 飞书通知渠道（第一个 adapter）。
 *
 * 出站直接用服务端 lark SDK 主动发消息，**不走 agent 的 MCP 工具**。为避免 Tower 单独装依赖，
 * 复用飞书 MCP 已装好的 SDK（路径可由 env `HARNESS_FEISHU_SDK_PATH` 覆盖）。appId/appSecret
 * 与 bot 的 `~/assistant/runtime/config.json` 同一套。
 */
const DEFAULT_SDK_PATH =
  "/Users/liujunping/.feishu-mcp/node_modules/@larksuiteoapi/node-sdk";

interface FeishuTarget {
  chatId: string;
  threadId?: string;
}

interface LarkClient {
  im: {
    message: {
      create(req: {
        params: { receive_id_type: string };
        data: Record<string, unknown>;
      }): Promise<{ data?: { message_id?: string } }>;
      reply(req: {
        path: { message_id: string };
        data: Record<string, unknown>;
      }): Promise<{ data?: { message_id?: string } }>;
    };
  };
}

// ask / failed 带 @（响），notify(progress) / done 不带 @（静）—— 收敛策略见 plan 定稿 ④。
const KIND_PREFIX: Record<OutboundKind, string> = {
  ask: "🙋 需要你决定",
  notify: "📎 进度更新",
  done: "✅ 任务完成",
  failed: "❌ 任务失败",
};

function renderText(msg: OutboundMessage): string {
  const prefix = KIND_PREFIX[msg.kind] ?? "📎";
  // 正文带 [[reply:id]] 兜底口令，便于人回复时对齐（飞书 bot 优先用线程绑定）。
  return `${prefix}｜${msg.title}\n\n${msg.body}\n\n[[reply:${msg.correlationId}]]`;
}

export function createFeishuChannel(cfg: {
  appId: string;
  appSecret: string;
  domain: string;
  sdkPath?: string;
}): NotifyChannel {
  const sdkPath = cfg.sdkPath || process.env.HARNESS_FEISHU_SDK_PATH || DEFAULT_SDK_PATH;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lark = require(sdkPath);
  const client: LarkClient = new lark.Client({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    domain: cfg.domain,
  });

  return {
    id: "feishu",
    async send(msg: OutboundMessage, target: unknown) {
      const t = target as FeishuTarget;
      if (!t?.chatId) throw new Error("feishu target requires chatId");
      const content = JSON.stringify({ text: renderText(msg) });

      // 一任务一话题：有 threadId 时 reply_in_thread 收敛到同一线程，否则新起一条群消息。
      if (t.threadId) {
        const res = await client.im.message.reply({
          path: { message_id: t.threadId },
          data: { msg_type: "text", content, reply_in_thread: true },
        });
        return { channelRef: res?.data?.message_id };
      }
      const res = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: { receive_id: t.chatId, msg_type: "text", content },
      });
      return { channelRef: res?.data?.message_id };
    },
  };
}
