import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { resolveCommandPathSync } from "@/lib/platform";
import { parseGatewaySendOutput, type GatewaySendMetadata } from "./gateway-output";

const execFileAsync = promisify(execFile);

export interface OpenClawSendInput {
  message: string;
  dest: string;
  downstream?: string | null;
  presentation?: unknown;
  replyToMessageId?: string | null;
  threadId?: string | null;
  env?: Record<string, string>;
}

interface OpenClawFeishuConfig {
  appId?: unknown;
  appSecret?: unknown;
  domain?: unknown;
}

interface OpenClawConfig {
  channels?: { feishu?: OpenClawFeishuConfig };
}

type FeishuContext = {
  appId: string;
  appSecret: string;
  domain: string;
};

type FeishuMessageReceipt = {
  message_id?: string;
  chat_id?: string;
  parent_id?: string;
  root_id?: string;
  msg_type?: string;
};

export function normalizeFeishuChatTarget(value: string | null | undefined):
  | { ok: true; chatId: string }
  | { ok: false; error: string } {
  const raw = value?.trim() || "";
  if (!raw) return { ok: false, error: "Feishu chat destination is required" };
  const match = raw.match(/^(?:feishu:)?(?:chat:)?(oc_[A-Za-z0-9_-]+)$/i);
  if (!match) return { ok: false, error: `Invalid Feishu chat destination: ${raw}` };
  return { ok: true, chatId: match[1] };
}

export async function sendViaOpenClaw(
  input: OpenClawSendInput,
): Promise<
  | { ok: true; output: string; metadata: GatewaySendMetadata }
  | { ok: false; output: string; metadata?: GatewaySendMetadata }
> {
  const channel = input.downstream?.trim();
  const target = input.dest.trim();
  if (!channel) return { ok: false, output: "OpenClaw downstream channel is required (e.g. slack, whatsapp, telegram)" };
  if (!target) return { ok: false, output: "OpenClaw destination is required" };

  const replyTo = input.replyToMessageId?.trim();
  const verifyNativeFeishuReply = channel.toLowerCase() === "feishu" && Boolean(replyTo);
  if (verifyNativeFeishuReply) {
    return sendNativeFeishuCardReply({
      message: input.message,
      presentation: input.presentation,
      replyToMessageId: replyTo!,
      dest: target,
      env: input.env,
    });
  }

  const cmd = process.env.OPENCLAW_CLI_PATH || resolveOpenClawCommand();
  const presentationJson = input.presentation ? JSON.stringify(input.presentation) : null;
  const primaryArgs = ["message", "send", "--channel", channel, "--target", target];
  if (input.replyToMessageId?.trim()) primaryArgs.push("--reply-to", input.replyToMessageId.trim());
  if (input.threadId?.trim()) primaryArgs.push("--thread-id", input.threadId.trim());
  if (presentationJson) primaryArgs.push("--presentation", presentationJson);
  else if (input.message.trim()) primaryArgs.push("--message", input.message);
  primaryArgs.push("--json");

  // A reply is part of the delivery contract. Presentation may degrade to
  // text, but no compatibility path is allowed to drop --reply-to.
  const replyArgs = input.replyToMessageId?.trim()
    ? ["--reply-to", input.replyToMessageId.trim()]
    : [];
  const argSets = presentationJson
    ? [
        primaryArgs,
        [
          "message", "send", "--channel", channel, "--target", target,
          ...replyArgs,
          ...(input.threadId?.trim() ? ["--thread-id", input.threadId.trim()] : []),
          "--message", input.message, "--json",
        ],
      ]
    : [
        primaryArgs,
      ];

  let lastOutput = "";
  for (const args of argSets) {
    try {
      const result = await execFileAsync(cmd, args, {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, ...(input.env ?? {}) },
      });
      // Node's execFile has a custom promisify result object. Some compatible
      // launchers and test doubles expose stdout directly, so accept both.
      const stdout = typeof result === "string" ? result : result.stdout;
      const stderr = typeof result === "string" ? "" : result.stderr;
      const output = `${stdout}${stderr}`.trim();
      const parsed = parseGatewaySendOutput(output);
      if (!parsed?.message_id) {
        lastOutput = `OpenClaw did not return a platform message id: ${output}`;
        break;
      }
      const metadata: GatewaySendMetadata = parsed;
      if (replyTo) {
        if (parsed.send_mode !== "reply" || parsed.reply_to_message_id !== replyTo) {
          return {
            ok: false,
            output: `OpenClaw did not confirm native reply target ${replyTo}`,
            metadata: parsed,
          };
        }
      }
      return {
        ok: true,
        output,
        metadata,
      };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      lastOutput = (e.stdout || e.stderr || e.message || String(err)).trim();
      if (!/unknown flag|unknown option|Usage:|accepts|requires/i.test(lastOutput)) break;
    }
  }

  return { ok: false, output: lastOutput };
}

export async function verifyOpenClawFeishuReply(input: {
  messageId: string;
  replyToMessageId: string;
  dest: string;
  env?: Record<string, string>;
}): Promise<
  | { ok: true; metadata: GatewaySendMetadata }
  | { ok: false; error: string }
> {
  try {
    const target = normalizeFeishuChatTarget(input.dest);
    if (!target.ok) return target;
    const replyToMessageId = input.replyToMessageId.trim();
    if (!replyToMessageId) return { ok: false, error: "Feishu reply parent message id is required" };
    const context = await readFeishuContext(input.env);
    const token = await getFeishuTenantToken(context);
    if (!token.ok) return token;
    return readAndVerifyFeishuReply({
      context,
      token: token.token,
      messageId: input.messageId,
      replyToMessageId,
      expectedChatId: target.chatId,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendNativeFeishuCardReply(input: {
  message: string;
  presentation?: unknown;
  replyToMessageId: string;
  dest: string;
  env?: Record<string, string>;
}): Promise<
  | { ok: true; output: string; metadata: GatewaySendMetadata }
  | { ok: false; output: string; metadata?: GatewaySendMetadata }
> {
  const target = normalizeFeishuChatTarget(input.dest);
  if (!target.ok) return { ok: false, output: target.error };
  if (!input.replyToMessageId.trim()) return { ok: false, output: "Feishu reply parent message id is required" };

  try {
    const context = await readFeishuContext(input.env);
    const token = await getFeishuTenantToken(context);
    if (!token.ok) return { ok: false, output: token.error };
    const card = toFeishuInteractiveCard(input.presentation, input.message);
    const response = await fetch(
      `${context.domain}/open-apis/im/v1/messages/${encodeURIComponent(input.replyToMessageId)}/reply`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.token}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ msg_type: "interactive", content: JSON.stringify(card) }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = await response.json() as {
      code?: number;
      msg?: string;
      data?: FeishuMessageReceipt;
    };
    const messageId = body.data?.message_id?.trim();
    if (!response.ok || body.code !== 0 || !messageId) {
      return {
        ok: false,
        output: `Feishu native reply failed (${body.code ?? response.status}: ${body.msg ?? "missing message_id"})`,
        ...(messageId ? { metadata: { platform: "feishu", message_id: messageId } } : {}),
      };
    }
    const verified = await readAndVerifyFeishuReply({
      context,
      token: token.token,
      messageId,
      replyToMessageId: input.replyToMessageId,
      expectedChatId: target.chatId,
    });
    if (!verified.ok) {
      return {
        ok: false,
        output: `Feishu sent ${messageId}, but native reply verification failed: ${verified.error}`,
        metadata: {
          platform: "feishu",
          message_id: messageId,
          chat_id: verified.receipt?.chat_id ?? body.data?.chat_id,
          reply_to_message_id: verified.receipt?.parent_id ?? body.data?.parent_id,
          msg_type: verified.receipt?.msg_type ?? body.data?.msg_type,
        },
      };
    }
    return { ok: true, output: JSON.stringify(body), metadata: verified.metadata };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}

async function readFeishuContext(env?: Record<string, string>): Promise<FeishuContext> {
  const configPath = env?.OPENCLAW_CONFIG_PATH?.trim()
    || process.env.OPENCLAW_CONFIG_PATH?.trim()
    || join(env?.OPENCLAW_STATE_DIR?.trim() || process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw"), "openclaw.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as OpenClawConfig;
  const feishu = config.channels?.feishu;
  const appId = typeof feishu?.appId === "string" ? feishu.appId.trim() : "";
  const appSecret = typeof feishu?.appSecret === "string" ? feishu.appSecret.trim() : "";
  if (!appId || !appSecret) throw new Error("OpenClaw Feishu credentials are not directly available");
  const domain = typeof feishu?.domain === "string" && feishu.domain.trim()
    ? feishu.domain.trim().replace(/\/$/, "")
    : "https://open.feishu.cn";
  return { appId, appSecret, domain };
}

async function getFeishuTenantToken(context: FeishuContext): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const response = await fetch(`${context.domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: context.appId, app_secret: context.appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json() as { code?: number; msg?: string; tenant_access_token?: string };
  if (!response.ok || !body.tenant_access_token) {
    return { ok: false, error: `Feishu auth failed (${body.code ?? response.status}: ${body.msg ?? "unknown"})` };
  }
  return { ok: true, token: body.tenant_access_token };
}

async function readAndVerifyFeishuReply(input: {
  context: FeishuContext;
  token: string;
  messageId: string;
  replyToMessageId: string;
  expectedChatId: string;
}): Promise<
  | { ok: true; metadata: GatewaySendMetadata }
  | { ok: false; error: string; receipt?: FeishuMessageReceipt }
> {
  const response = await fetch(
    `${input.context.domain}/open-apis/im/v1/messages/${encodeURIComponent(input.messageId)}`,
    {
      headers: { authorization: `Bearer ${input.token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = await response.json() as {
    code?: number;
    msg?: string;
    data?: { items?: FeishuMessageReceipt[] };
  };
  const item = body.data?.items?.find((candidate) => candidate.message_id === input.messageId);
  if (!response.ok || !item) {
    return { ok: false, error: `Feishu message receipt unavailable (${body.code ?? response.status}: ${body.msg ?? "unknown"})` };
  }
  if (item.chat_id !== input.expectedChatId) {
    return { ok: false, error: `receipt chat mismatch (expected ${input.expectedChatId}, got ${item.chat_id ?? "unknown"})`, receipt: item };
  }
  if (item.parent_id !== input.replyToMessageId) {
    return { ok: false, error: `receipt is not a native reply (expected parent ${input.replyToMessageId}, got ${item.parent_id ?? "none"})`, receipt: item };
  }
  if (item.msg_type !== "interactive") {
    return { ok: false, error: `receipt message type mismatch (expected interactive, got ${item.msg_type ?? "unknown"})`, receipt: item };
  }
  return {
    ok: true,
    metadata: {
      platform: "feishu",
      chat_id: item.chat_id,
      message_id: item.message_id,
      reply_to_message_id: item.parent_id,
      msg_type: item.msg_type,
      send_mode: "reply",
    },
  };
}

function toFeishuInteractiveCard(presentation: unknown, fallbackMessage: string): Record<string, unknown> {
  const value = presentation && typeof presentation === "object"
    ? presentation as { title?: unknown; tone?: unknown; blocks?: unknown }
    : {};
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Tower";
  const blocks = Array.isArray(value.blocks) ? value.blocks : [{ type: "text", text: fallbackMessage }];
  const elements = blocks.flatMap((block): Array<Record<string, unknown>> => {
    if (!block || typeof block !== "object") return [];
    const item = block as { type?: unknown; text?: unknown };
    if (item.type === "divider") return [{ tag: "hr" }];
    if (typeof item.text !== "string" || !item.text.trim()) return [];
    if (item.type === "context") {
      return [{ tag: "note", elements: [{ tag: "plain_text", content: item.text }] }];
    }
    return [{ tag: "div", text: { tag: "lark_md", content: item.text } }];
  });
  const template = {
    info: "blue",
    success: "green",
    warning: "orange",
    danger: "red",
    neutral: "grey",
  }[typeof value.tone === "string" ? value.tone : "neutral"] || "grey";
  return {
    config: { wide_screen_mode: true },
    header: { template, title: { tag: "plain_text", content: title } },
    elements: elements.length > 0 ? elements : [{ tag: "div", text: { tag: "lark_md", content: fallbackMessage } }],
  };
}

function resolveOpenClawCommand(): string {
  try {
    return resolveCommandPathSync("openclaw");
  } catch {
    return `${process.env.HOME}/.local/bin/openclaw`;
  }
}
