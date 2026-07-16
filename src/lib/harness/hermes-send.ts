import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveCommandPathSync } from "@/lib/platform";

const execFileAsync = promisify(execFile);

export interface HermesSendInput {
  message: string;
  dest?: string | null;
  downstream?: string | null;
  profile?: string | null;
  env?: Record<string, string>;
}

export async function sendViaHermes(input: HermesSendInput): Promise<{ ok: true; output: string } | { ok: false; output: string }> {
  const cmd = process.env.HERMES_CLI_PATH || resolveHermesCommand();
  const args = [];
  const profile = input.profile?.trim() || process.env.HERMES_PROFILE?.trim();
  if (profile) args.push("--profile", profile);
  args.push("send");
  const to = normalizeHermesDest(input.dest, input.downstream);
  if (!to) return { ok: false, output: "Hermes destination is required (e.g. feishu:oc_xxx)" };
  args.push("--to", to);
  args.push("--json", input.message);

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ...(input.env ?? {}) },
    });
    return { ok: true, output: `${stdout}${stderr}`.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: (e.stdout || e.stderr || e.message || String(err)).trim() };
  }
}

function resolveHermesCommand(): string {
  try {
    return resolveCommandPathSync("hermes");
  } catch {
    return `${process.env.HOME}/.local/bin/hermes`;
  }
}

function normalizeHermesDest(dest?: string | null, downstream?: string | null): string | null {
  const raw = dest?.trim();
  const ds = downstream?.trim().toLowerCase();
  const platform = ds === "wechat" ? "weixin" : ds;
  if (!raw) return platform || null;
  if (/^[a-z][a-z0-9_-]*:/i.test(raw)) return raw;
  if (ds === "feishu" && raw.startsWith("oc_")) return `feishu:${raw}`;
  if (platform === "weixin") return `weixin:${raw}`;
  return raw;
}
