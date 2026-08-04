import { execFile } from "node:child_process";
import { homedir, platform as hostPlatform } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CapabilityJobStatus =
  | "ACCEPTED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "SIDE_EFFECT_UNKNOWN";

interface OpenClawTaskRecord {
  taskId?: unknown;
  runId?: unknown;
  status?: unknown;
  lastEventAt?: unknown;
  createdAt?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  terminalSummary?: unknown;
  error?: unknown;
}

export interface CapabilityJobSnapshot {
  gateway: "openclaw";
  requestedRef: string;
  jobRef: string;
  runId: string | null;
  status: CapabilityJobStatus;
  revision: string;
  updatedAt: string;
  summary: string | null;
}

export function normalizeOpenClawTaskStatus(status: unknown): CapabilityJobStatus {
  switch (status) {
    case "queued":
      return "ACCEPTED";
    case "running":
      return "RUNNING";
    case "succeeded":
      return "SUCCEEDED";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    case "timed_out":
      return "EXPIRED";
    case "lost":
    default:
      // A lost multi-step task may already have changed an external system.
      // The read-only adapter cannot prove otherwise, so fail conservatively.
      return "SIDE_EFFECT_UNKNOWN";
  }
}

function asTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function openClawProcessEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const home = env.HOME || env.USERPROFILE || homedir();
  const supplemental = hostPlatform() === "win32"
    ? [
        env.APPDATA ? join(env.APPDATA, "npm") : "",
        env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "openclaw") : "",
      ]
    : [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        join(home, ".local", "bin"),
        join(home, ".bun", "bin"),
        join(home, ".npm-global", "bin"),
      ];
  env[pathKey] = [...new Set([
    ...(env[pathKey] ?? "").split(delimiter),
    ...supplemental,
  ].filter(Boolean))].join(delimiter);
  return env;
}

export function parseOpenClawTaskSnapshot(
  requestedRef: string,
  value: unknown,
): CapabilityJobSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OpenClaw returned an invalid task record");
  }
  const record = value as OpenClawTaskRecord;
  const taskId = asNonEmptyString(record.taskId);
  if (!taskId) throw new Error("OpenClaw task record is missing taskId");
  const updatedMs = asTimestamp(record.lastEventAt)
    ?? asTimestamp(record.endedAt)
    ?? asTimestamp(record.startedAt)
    ?? asTimestamp(record.createdAt);
  if (!updatedMs) throw new Error("OpenClaw task record is missing a revision timestamp");
  const summary = asNonEmptyString(record.terminalSummary)
    ?? asNonEmptyString(record.error);
  return {
    gateway: "openclaw",
    requestedRef,
    jobRef: taskId,
    runId: asNonEmptyString(record.runId),
    status: normalizeOpenClawTaskStatus(record.status),
    revision: String(updatedMs),
    updatedAt: new Date(updatedMs).toISOString(),
    summary,
  };
}

export function parseOpenClawTaskOutput(output: string): unknown {
  const trimmed = output.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // OpenClaw may print state-migration notes before an otherwise valid
    // --json response. Discard only complete prefix lines; the remaining
    // suffix must be one fully valid JSON value with no trailing text.
    const lines = trimmed.split(/\r?\n/);
    const firstJsonLine = lines.findIndex((line) => line.trimStart().startsWith("{"));
    if (firstJsonLine < 0) {
      throw new Error("OpenClaw returned a non-JSON task response");
    }
    const firstLine = lines[firstJsonLine];
    const objectStart = firstLine.indexOf("{");
    lines[firstJsonLine] = firstLine.slice(objectStart);
    try {
      return JSON.parse(lines.slice(firstJsonLine).join("\n"));
    } catch {
      throw new Error("OpenClaw returned a non-JSON task response");
    }
  }
}

export async function readOpenClawCapabilityJob(
  jobRef: string,
  env: Record<string, string> = {},
): Promise<CapabilityJobSnapshot> {
  const ref = jobRef.trim();
  if (!/^[A-Za-z0-9:._-]{1,256}$/.test(ref)) {
    throw new Error("Invalid OpenClaw job reference");
  }
  // Keep the optional adapter on Node-only dependencies so source stdio, the
  // bundled server, and the published CLI have the same module-loading path.
  const command = env.OPENCLAW_CLI_PATH || process.env.OPENCLAW_CLI_PATH || "openclaw";
  const result = await execFileAsync(command, ["tasks", "show", ref, "--json"], {
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
    env: openClawProcessEnv(env),
    // npm-installed Windows CLIs are .cmd shims; the ref is already strictly
    // allow-listed above and every other argument is a fixed literal.
    shell: hostPlatform() === "win32",
  });
  const streams = typeof result === "string"
    ? [result]
    : [result.stdout, result.stderr];
  let parsed: unknown;
  let parseError: unknown;
  for (const stream of streams) {
    if (!stream?.trim()) continue;
    try {
      parsed = parseOpenClawTaskOutput(stream);
      parseError = undefined;
      break;
    } catch (error) {
      parseError = error;
    }
  }
  if (parseError || parsed === undefined) {
    throw new Error("OpenClaw returned a non-JSON task response");
  }
  return parseOpenClawTaskSnapshot(ref, parsed);
}
