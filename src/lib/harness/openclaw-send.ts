import { execFile } from "node:child_process";
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

export async function sendViaOpenClaw(
  input: OpenClawSendInput,
): Promise<
  | { ok: true; output: string; metadata: GatewaySendMetadata }
  | { ok: false; output: string; metadata?: undefined }
> {
  const cmd = process.env.OPENCLAW_CLI_PATH || resolveOpenClawCommand();
  const channel = input.downstream?.trim();
  const target = input.dest.trim();
  if (!channel) return { ok: false, output: "OpenClaw downstream channel is required (e.g. slack, whatsapp, telegram)" };
  if (!target) return { ok: false, output: "OpenClaw destination is required" };

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
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, ...(input.env ?? {}) },
      });
      const output = `${stdout}${stderr}`.trim();
      const parsed = parseGatewaySendOutput(output);
      if (!parsed?.message_id) {
        lastOutput = `OpenClaw did not return a platform message id: ${output}`;
        break;
      }
      const replyTo = input.replyToMessageId?.trim();
      return {
        ok: true,
        output,
        metadata: {
          ...parsed,
          ...(replyTo ? { reply_to_message_id: replyTo, send_mode: "reply" as const } : {}),
        },
      };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      lastOutput = (e.stdout || e.stderr || e.message || String(err)).trim();
      if (!/unknown flag|unknown option|Usage:|accepts|requires/i.test(lastOutput)) break;
    }
  }

  return { ok: false, output: lastOutput };
}

function resolveOpenClawCommand(): string {
  try {
    return resolveCommandPathSync("openclaw");
  } catch {
    return `${process.env.HOME}/.local/bin/openclaw`;
  }
}
