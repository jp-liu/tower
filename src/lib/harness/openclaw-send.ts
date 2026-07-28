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

export async function sendViaOpenClaw(
  input: OpenClawSendInput,
): Promise<
  | { ok: true; output: string; metadata: GatewaySendMetadata }
  | { ok: false; output: string; metadata?: GatewaySendMetadata }
> {
  const cmd = process.env.OPENCLAW_CLI_PATH || resolveOpenClawCommand();
  const channel = input.downstream?.trim();
  const target = input.dest.trim();
  if (!channel) return { ok: false, output: "OpenClaw downstream channel is required (e.g. slack, whatsapp, telegram)" };
  if (!target) return { ok: false, output: "OpenClaw destination is required" };

  const replyTo = input.replyToMessageId?.trim();
  const verifyNativeFeishuReply = channel.toLowerCase() === "feishu" && Boolean(replyTo);
  // OpenClaw 2026.6 accepts --reply-to with --presentation but its durable
  // presentation path can still create a top-level Feishu card. Text replies
  // use the native reply path and remain an allowed presentation fallback.
  const presentationJson = input.presentation && !verifyNativeFeishuReply
    ? JSON.stringify(input.presentation)
    : null;
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
      let metadata: GatewaySendMetadata = parsed;
      if (replyTo) {
        if (verifyNativeFeishuReply) {
          const receipt = await verifyOpenClawFeishuReply({
            messageId: parsed.message_id,
            replyToMessageId: replyTo,
            dest: target,
            env: input.env,
          });
          if (!receipt.ok) {
            return {
              ok: false,
              output: `OpenClaw sent ${parsed.message_id}, but Feishu reply verification failed: ${receipt.error}`,
              metadata: parsed,
            };
          }
          metadata = receipt.metadata;
        } else if (parsed.send_mode !== "reply" || parsed.reply_to_message_id !== replyTo) {
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
    const configPath = input.env?.OPENCLAW_CONFIG_PATH?.trim()
      || process.env.OPENCLAW_CONFIG_PATH?.trim()
      || join(input.env?.OPENCLAW_STATE_DIR?.trim() || process.env.OPENCLAW_STATE_DIR?.trim() || join(homedir(), ".openclaw"), "openclaw.json");
    const config = JSON.parse(await readFile(configPath, "utf8")) as OpenClawConfig;
    const feishu = config.channels?.feishu;
    const appId = typeof feishu?.appId === "string" ? feishu.appId.trim() : "";
    const appSecret = typeof feishu?.appSecret === "string" ? feishu.appSecret.trim() : "";
    const domain = typeof feishu?.domain === "string" && feishu.domain.trim()
      ? feishu.domain.trim().replace(/\/$/, "")
      : "https://open.feishu.cn";
    if (!appId || !appSecret) return { ok: false, error: "OpenClaw Feishu credentials are not directly verifiable" };

    const authResponse = await fetch(`${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(10_000),
    });
    const auth = await authResponse.json() as { code?: number; msg?: string; tenant_access_token?: string };
    if (!authResponse.ok || !auth.tenant_access_token) {
      return { ok: false, error: `Feishu auth failed (${auth.code ?? authResponse.status}: ${auth.msg ?? "unknown"})` };
    }

    const messageResponse = await fetch(
      `${domain}/open-apis/im/v1/messages/${encodeURIComponent(input.messageId)}`,
      {
        headers: { authorization: `Bearer ${auth.tenant_access_token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = await messageResponse.json() as {
      code?: number;
      msg?: string;
      data?: { items?: Array<{ message_id?: string; chat_id?: string; parent_id?: string; root_id?: string }> };
    };
    const item = body.data?.items?.find((candidate) => candidate.message_id === input.messageId);
    if (!messageResponse.ok || !item) {
      return { ok: false, error: `Feishu message receipt unavailable (${body.code ?? messageResponse.status}: ${body.msg ?? "unknown"})` };
    }
    const expectedChatId = input.dest.replace(/^feishu:/i, "");
    if (item.chat_id !== expectedChatId) {
      return { ok: false, error: `receipt chat mismatch (expected ${expectedChatId}, got ${item.chat_id ?? "unknown"})` };
    }
    if (item.parent_id !== input.replyToMessageId) {
      return {
        ok: false,
        error: `receipt is not a native reply (expected parent ${input.replyToMessageId}, got ${item.parent_id ?? "none"})`,
      };
    }
    return {
      ok: true,
      metadata: {
        platform: "feishu",
        chat_id: item.chat_id,
        message_id: item.message_id,
        reply_to_message_id: item.parent_id,
        send_mode: "reply",
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function resolveOpenClawCommand(): string {
  try {
    return resolveCommandPathSync("openclaw");
  } catch {
    return `${process.env.HOME}/.local/bin/openclaw`;
  }
}
