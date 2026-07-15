import { execFile } from "node:child_process";
import { readConfigValue } from "@/lib/config-reader";
import { db } from "@/lib/db";
import { sendViaHermes } from "@/lib/harness/hermes-send";
import { sendViaOpenClaw } from "@/lib/harness/openclaw-send";
import { resolveCommandPathSync } from "@/lib/platform";

export type HarnessGateway = "hermes" | "openclaw";

export interface HarnessDestination {
  alias?: string;
  label?: string;
  gateway?: string;
  platform?: string;
  downstream?: string;
  dest: string;
  scope?: "work" | "unattended";
}

export interface HarnessGatewaySendInput {
  gateway: string;
  downstream?: string | null;
  dest?: string | null;
  to?: string | null;
  profile?: string | null;
  message: string;
  scope: "work" | "unattended";
}

export interface HarnessGatewaySendResult {
  ok: boolean;
  output: string;
  resolvedDest?: string | null;
}

export async function sendViaHarnessGateway(input: HarnessGatewaySendInput): Promise<HarnessGatewaySendResult> {
  const gateway = normalizeGateway(input.gateway);
  if (!gateway) return { ok: false, output: `Unsupported gateway: ${input.gateway}` };

  const resolvedDest = await resolveHarnessDestination({
    gateway,
    downstream: input.downstream,
    dest: input.dest,
    to: input.to,
    profile: input.profile,
    scope: input.scope,
  });
  if (!resolvedDest.ok) return { ok: false, output: resolvedDest.error };

  if (gateway === "hermes") {
    const sent = await sendViaHermes({
      message: input.message,
      dest: resolvedDest.dest,
      downstream: input.downstream,
      profile: input.profile,
    });
    return { ...sent, resolvedDest: resolvedDest.dest };
  }

  const sent = await sendViaOpenClaw({
    message: input.message,
    dest: resolvedDest.dest || "",
    downstream: input.downstream,
  });
  return { ...sent, resolvedDest: resolvedDest.dest };
}

export async function resolveHarnessDestination(input: {
  gateway: HarnessGateway;
  downstream?: string | null;
  dest?: string | null;
  to?: string | null;
  profile?: string | null;
  scope: "work" | "unattended";
}): Promise<{ ok: true; dest: string | null } | { ok: false; error: string }> {
  const platform = input.downstream?.trim().toLowerCase() || "";
  if (isHermesWechatUnattendedHome(input.gateway, platform, input.scope)) {
    return { ok: true, dest: null };
  }

  const requested = input.to?.trim() || input.dest?.trim() || "";

  if (!requested && input.gateway === "hermes" && input.scope === "unattended") {
    return { ok: true, dest: platform || null };
  }
  if (!requested) {
    return {
      ok: false,
      error:
        input.scope === "work"
          ? "Work messages require a destination (pass `to`, e.g. a group name or platform id)"
          : "Destination is required",
    };
  }

  const byAlias = await findDestinationByAlias({
    gateway: input.gateway,
    platform,
    query: requested,
    scope: input.scope,
  });
  if (byAlias) return { ok: true, dest: byAlias.dest };

  const byDirectory = await findDestinationInHermesDirectory({
    gateway: input.gateway,
    platform,
    query: requested,
    profile: input.profile,
  });
  if (byDirectory) return { ok: true, dest: byDirectory };

  const byOpenClawDirectory = await findDestinationInOpenClawDirectory({
    gateway: input.gateway,
    platform,
    query: requested,
    scope: input.scope,
  });
  if (byOpenClawDirectory) return { ok: true, dest: byOpenClawDirectory };

  return { ok: true, dest: normalizePlatformDest(requested, platform) };
}

export function normalizeGateway(value: string | null | undefined): HarnessGateway | null {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "hermes" || raw === "openclaw") return raw;
  return null;
}

function normalizePlatformDest(value: string, platform: string): string {
  const raw = value.trim();
  if (!raw) return raw;
  if (/^[a-z][a-z0-9_-]*:/i.test(raw)) return raw;
  if (platform === "feishu" && raw.startsWith("oc_")) return `feishu:${raw}`;
  if ((platform === "wechat" || platform === "weixin") && !raw.includes(":")) return `weixin:${raw}`;
  if (platform && isLikelyPlatformId(raw)) return `${platform}:${raw}`;
  return raw;
}

function isLikelyPlatformId(value: string): boolean {
  return /^(oc_|ou_|on_|[CDG][A-Z0-9]{8,}|-?\d{6,}|[0-9A-Fa-f._-]+@g\.us$)/.test(value);
}

function isHermesWechatUnattendedHome(
  gateway: HarnessGateway,
  platform: string,
  scope: "work" | "unattended",
): boolean {
  return gateway === "hermes" && scope === "unattended" && (platform === "wechat" || platform === "weixin");
}

async function findDestinationByAlias(input: {
  gateway: HarnessGateway;
  platform: string;
  query: string;
  scope: "work" | "unattended";
}): Promise<HarnessDestination | null> {
  const destinations = await readConfigValue<HarnessDestination[]>("harness.destinations", []);
  const normalized = normalizeName(input.query);
  const matches = (Array.isArray(destinations) ? destinations : []).filter((item) => {
    if (!item?.dest) return false;
    const gateway = item.gateway?.trim().toLowerCase();
    const platform = (item.platform || item.downstream || "").trim().toLowerCase();
    const scope = item.scope ?? "work";
    if (gateway && gateway !== input.gateway) return false;
    if (platform && input.platform && platform !== input.platform) return false;
    if (scope !== input.scope) return false;
    return [item.alias, item.label, item.dest].some((x) => normalizeName(x) === normalized);
  });
  if (matches.length === 1) return matches[0];
  const uniqueDests = new Set(matches.map((item) => item.dest));
  return uniqueDests.size === 1 ? matches[0] : null;
}

async function findDestinationInHermesDirectory(input: {
  gateway: HarnessGateway;
  platform: string;
  query: string;
  profile?: string | null;
}): Promise<string | null> {
  if (input.gateway !== "hermes") return null;
  const profile = input.profile?.trim() || process.env.HERMES_PROFILE?.trim();
  if (!profile) return null;
  const fs = await import("node:fs/promises");
  const path = `${process.env.HOME}/.hermes/profiles/${profile}/channel_directory.json`;
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as {
      platforms?: Record<string, Array<{ id?: string; name?: string; type?: string }>>;
    };
    const entries = parsed.platforms?.[input.platform] ?? [];
    const normalized = normalizeName(input.query);
    const matches = entries.filter((entry) =>
      [entry.name, entry.id].some((x) => normalizeName(x) === normalized),
    );
    if (matches.length !== 1 || !matches[0].id) return null;
    return normalizePlatformDest(matches[0].id, input.platform);
  } catch {
    return null;
  }
}

async function findDestinationInOpenClawDirectory(input: {
  gateway: HarnessGateway;
  platform: string;
  query: string;
  scope: "work" | "unattended";
}): Promise<string | null> {
  if (input.gateway !== "openclaw" || !input.platform) return null;
  const raw = input.query.trim();
  if (!raw || /^[a-z][a-z0-9_-]*:/i.test(raw) || isLikelyPlatformId(raw)) return null;

  try {
    const cmd = process.env.OPENCLAW_CLI_PATH || resolveOpenClawCommand();
    const { stdout } = await execFilePromise(
      cmd,
      ["directory", "groups", "list", "--channel", input.platform, "--query", raw, "--json", "--limit", "10"],
      { timeout: 20_000, maxBuffer: 1024 * 1024, env: process.env },
    );
    const parsed = JSON.parse(stdout) as Array<{ id?: string; name?: string }>;
    const normalized = normalizeName(raw);
    const matches = (Array.isArray(parsed) ? parsed : []).filter((entry) =>
      [entry.name, entry.id].some((x) => normalizeName(x) === normalized),
    );
    if (matches.length !== 1 || !matches[0].id) return null;
    const dest = normalizePlatformDest(matches[0].id, input.platform);
    await cacheDestinationAlias({
      gateway: input.gateway,
      platform: input.platform,
      scope: input.scope,
      alias: raw,
      label: matches[0].name || raw,
      dest,
    });
    return dest;
  } catch {
    return null;
  }
}

async function cacheDestinationAlias(input: {
  gateway: HarnessGateway;
  platform: string;
  scope: "work" | "unattended";
  alias: string;
  label: string;
  dest: string;
}): Promise<void> {
  try {
    const current = await readConfigValue<HarnessDestination[]>("harness.destinations", []);
    const destinations = Array.isArray(current) ? current.slice() : [];
    const normalizedAlias = normalizeName(input.alias);
    const existingIndex = destinations.findIndex((item) => {
      const gateway = item.gateway?.trim().toLowerCase();
      const platform = (item.platform || item.downstream || "").trim().toLowerCase();
      const scope = item.scope ?? "work";
      return (
        gateway === input.gateway &&
        platform === input.platform &&
        scope === input.scope &&
        normalizeName(item.alias) === normalizedAlias
      );
    });
    const nextItem: HarnessDestination = {
      ...(existingIndex >= 0 ? destinations[existingIndex] : {}),
      alias: input.alias,
      label: input.label,
      gateway: input.gateway,
      platform: input.platform,
      dest: input.dest,
      scope: input.scope,
    };
    if (existingIndex >= 0) destinations[existingIndex] = nextItem;
    else destinations.push(nextItem);

    await db.systemConfig.upsert({
      where: { key: "harness.destinations" },
      create: { key: "harness.destinations", value: JSON.stringify(destinations) },
      update: { value: JSON.stringify(destinations) },
    });
  } catch {
    // Sending should not fail just because the local alias cache could not be updated.
  }
}

function execFilePromise(
  cmd: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function resolveOpenClawCommand(): string {
  try {
    return resolveCommandPathSync("openclaw");
  } catch {
    return `${process.env.HOME}/.local/bin/openclaw`;
  }
}

function normalizeName(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/[「」"']/g, "")
    .replace(/群$/u, "")
    .toLowerCase();
}
