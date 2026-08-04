import "server-only";

import { execFile } from "node:child_process";
import { platform as hostPlatform } from "node:os";
import { promisify } from "node:util";
import { openClawProcessEnv, parseOpenClawTaskOutput } from "./openclaw-task-client";

const execFileAsync = promisify(execFile);
const METHODS = new Set([
  "tower.capabilities.discover",
  "tower.capabilities.submit",
]);

export interface OpenClawCapabilityDescriptor {
  capability: string;
  description: string;
  lane: "JOB";
  risk: "R0" | "R1" | "R2" | "R3";
  available: boolean;
  availability: "CONFIGURED" | "UNAVAILABLE";
  gateway: "openclaw";
  routeRevision: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface OpenClawCapabilityAccepted {
  requestId: string;
  jobRef: string;
  runId: string;
  status: "ACCEPTED";
  revision: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function invokeOpenClawCapabilityMethod(
  method: "tower.capabilities.discover" | "tower.capabilities.submit",
  params: Record<string, unknown>,
  env: Record<string, string> = {},
): Promise<unknown> {
  if (!METHODS.has(method)) throw new Error("Unsupported OpenClaw capability method");
  const command = env.OPENCLAW_CLI_PATH || process.env.OPENCLAW_CLI_PATH || "openclaw";
  const result = await execFileAsync(command, [
    "gateway",
    "call",
    method,
    "--params",
    JSON.stringify(params),
    "--json",
    "--timeout",
    "20000",
  ], {
    timeout: 25_000,
    maxBuffer: 1024 * 1024,
    env: openClawProcessEnv(env),
    shell: hostPlatform() === "win32",
  });
  const streams = typeof result === "string" ? [result] : [result.stdout, result.stderr];
  for (const stream of streams) {
    if (!stream?.trim()) continue;
    try {
      return parseOpenClawTaskOutput(stream);
    } catch {
      // The other stream may contain the JSON response.
    }
  }
  throw new Error("OpenClaw returned a non-JSON capability response");
}

export async function discoverOpenClawCapabilities(
  env: Record<string, string> = {},
): Promise<OpenClawCapabilityDescriptor[]> {
  const raw = object(await invokeOpenClawCapabilityMethod("tower.capabilities.discover", {}, env));
  if (raw?.schemaVersion !== 1 || raw.registryAuthority !== "openclaw" || !Array.isArray(raw.capabilities)) {
    throw new Error("OpenClaw returned an invalid capability discovery response");
  }
  return raw.capabilities.flatMap((value) => {
    const row = object(value);
    const inputSchema = object(row?.inputSchema);
    const outputSchema = object(row?.outputSchema);
    if (
      !row
      || typeof row.capability !== "string"
      || typeof row.description !== "string"
      || row.lane !== "JOB"
      || !["R0", "R1", "R2", "R3"].includes(String(row.risk))
      || row.gateway !== "openclaw"
      || typeof row.routeRevision !== "string"
      || !inputSchema
      || !outputSchema
    ) return [];
    return [{
      capability: row.capability,
      description: row.description,
      lane: "JOB",
      risk: row.risk as OpenClawCapabilityDescriptor["risk"],
      available: row.available === true,
      availability: row.available === true ? "CONFIGURED" : "UNAVAILABLE",
      gateway: "openclaw",
      routeRevision: row.routeRevision,
      inputSchema,
      outputSchema,
    }];
  });
}

export async function submitOpenClawCapabilityJob(
  input: {
    requestId: string;
    capability: string;
    inputs: Record<string, unknown>;
    towerContext: { taskId: string; projectId?: string };
    callback: { url: string; token: string };
  },
  env: Record<string, string> = {},
): Promise<OpenClawCapabilityAccepted> {
  const raw = object(await invokeOpenClawCapabilityMethod("tower.capabilities.submit", input, env));
  if (
    raw?.requestId !== input.requestId
    || typeof raw.jobRef !== "string"
    || !raw.jobRef.trim()
    || typeof raw.runId !== "string"
    || raw.status !== "ACCEPTED"
    || typeof raw.revision !== "string"
  ) throw new Error("OpenClaw returned an invalid capability acceptance response");
  return {
    requestId: input.requestId,
    jobRef: raw.jobRef,
    runId: raw.runId,
    status: "ACCEPTED",
    revision: raw.revision,
  };
}
