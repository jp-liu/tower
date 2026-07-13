import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveCommandPathSync } from "@/lib/platform";

const execFileAsync = promisify(execFile);

export interface OpenClawSendInput {
  message: string;
  dest: string;
  downstream?: string | null;
}

export async function sendViaOpenClaw(
  input: OpenClawSendInput,
): Promise<{ ok: true; output: string } | { ok: false; output: string }> {
  const cmd = process.env.OPENCLAW_CLI_PATH || resolveOpenClawCommand();
  const channel = input.downstream?.trim();
  const target = input.dest.trim();
  if (!channel) return { ok: false, output: "OpenClaw downstream channel is required (e.g. slack, whatsapp, telegram)" };
  if (!target) return { ok: false, output: "OpenClaw destination is required" };

  const argSets = [
    ["message", "send", "--channel", channel, "--target", target, "--message", input.message],
    ["message", "send", channel, target, input.message],
  ];

  let lastOutput = "";
  for (const args of argSets) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      return { ok: true, output: `${stdout}${stderr}`.trim() };
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
