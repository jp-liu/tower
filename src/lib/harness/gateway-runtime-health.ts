import "server-only";

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { db } from "@/lib/db";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 160_000;
const MAX_LOG_LINES = 120;

export type GatewayRuntimeKind = "openclaw" | "hermes";

function shortenHome(value: string): string {
  const home = os.homedir();
  return home ? value.split(home).join("<HOME>") : value;
}

export function redactGatewayDiagnosticText(value: string): string {
  return shortenHome(value)
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 [REDACTED]")
    .replace(/((?:api[_-]?key|token|secret|password|credential|appSecret|encryptKey|verificationToken)\s*[=:]\s*)[^\s,;"']+/gi, "$1[REDACTED]")
    .replace(/("(?:api[_-]?key|token|secret|password|credential|appSecret|encryptKey|verificationToken)"\s*:\s*")[^"]*"/gi, "$1[REDACTED]\"")
    .replace(/\b(?:sk|xox[baprs]|gh[opsu])-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]");
}

async function run(command: string, args: string[], timeout = 10_000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout,
      maxBuffer: MAX_OUTPUT,
      env: process.env,
    });
    return {
      ok: true as const,
      output: redactGatewayDiagnosticText(`${stdout}${stderr ? `\n${stderr}` : ""}`.trim()),
    };
  } catch (error) {
    const detail = error && typeof error === "object"
      ? `${"stdout" in error ? String(error.stdout ?? "") : ""}\n${"stderr" in error ? String(error.stderr ?? "") : ""}`.trim()
      : "";
    return {
      ok: false as const,
      error: redactGatewayDiagnosticText(detail || (error instanceof Error ? error.message : String(error))),
    };
  }
}

function boundedLogLines(output: string, trace?: string): string[] {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  if (trace?.trim()) {
    const needle = trace.trim().toLowerCase();
    const matched = lines.filter((line) => line.toLowerCase().includes(needle));
    if (matched.length > 0) return matched.slice(-MAX_LOG_LINES);
  }
  return lines.filter((line) => /\b(error|warn|failed|timeout|disconnect|unavailable)\b/i.test(line))
    .slice(-MAX_LOG_LINES);
}

function summarizeOpenClawStatus(output: string) {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    const service = parsed.service && typeof parsed.service === "object" ? parsed.service as Record<string, unknown> : {};
    const runtime = service.runtime && typeof service.runtime === "object" ? service.runtime as Record<string, unknown> : {};
    const gateway = parsed.gateway && typeof parsed.gateway === "object" ? parsed.gateway as Record<string, unknown> : {};
    const rpc = parsed.rpc && typeof parsed.rpc === "object" ? parsed.rpc as Record<string, unknown> : {};
    return {
      version: gateway.version ?? null,
      serviceLoaded: service.loaded ?? null,
      runtimeStatus: runtime.status ?? runtime.state ?? null,
      pid: runtime.pid ?? null,
      bindHost: gateway.bindHost ?? null,
      port: gateway.port ?? null,
      rpcOk: rpc.ok ?? null,
      configAudit: service.configAudit ?? null,
    };
  } catch {
    return { summary: output.slice(0, 4_000) };
  }
}

async function towerControlPlaneHealth() {
  const now = new Date();
  const [lease, outbounds, batches] = await Promise.all([
    db.towerRuntimeLease.findUnique({ where: { id: "tower-runtime" } }),
    db.harnessOutbound.groupBy({ by: ["state"], _count: { _all: true } }),
    db.workbenchBatch.groupBy({
      by: ["state"],
      where: { state: { in: ["CLAIMED", "DISPATCHED", "ACKED", "FAILED"] } },
      _count: { _all: true },
    }),
  ]);
  return {
    runtimeLease: lease
      ? {
          pid: lease.pid,
          port: lease.port,
          generation: lease.generation,
          owned: lease.expiresAt > now,
          expiresAt: lease.expiresAt.toISOString(),
          lastHeartbeatAt: lease.lastHeartbeatAt.toISOString(),
        }
      : null,
    harnessOutbounds: Object.fromEntries(
      outbounds.map((row) => [row.state, row._count._all]),
    ),
    activeWorkbenchBatches: Object.fromEntries(
      batches.map((row) => [row.state, row._count._all]),
    ),
  };
}

export async function getGatewayRuntimeHealth(input: {
  gateway: GatewayRuntimeKind;
  trace?: string;
  includeLogs?: boolean;
}) {
  if (input.gateway === "openclaw") {
    const [status, tower] = await Promise.all([
      run("openclaw", ["gateway", "status", "--json"]),
      towerControlPlaneHealth(),
    ]);
    const logs = input.includeLogs === false
      ? null
      : await run("openclaw", [
          "logs",
          "--plain",
          "--no-color",
          "--limit",
          "240",
          "--max-bytes",
          "150000",
          "--timeout",
          "6000",
        ], 8_000);
    return {
      gateway: "openclaw" as const,
      healthy: status.ok && Boolean((summarizeOpenClawStatus(status.output) as { rpcOk?: unknown }).rpcOk),
      status: status.ok ? summarizeOpenClawStatus(status.output) : { error: status.error },
      tower,
      logs: logs
        ? logs.ok
          ? { matchedTrace: Boolean(input.trace && logs.output.toLowerCase().includes(input.trace.toLowerCase())), lines: boundedLogLines(logs.output, input.trace) }
          : { error: logs.error, lines: [] }
        : null,
    };
  }

  const [status, gatewayLogs, errorLogs, tower] = await Promise.all([
    run("hermes", ["status", "--all"], 12_000),
    input.includeLogs === false ? Promise.resolve(null) : run("hermes", ["logs", "gateway", "-n", "120"], 8_000),
    input.includeLogs === false ? Promise.resolve(null) : run("hermes", ["logs", "errors", "-n", "120"], 8_000),
    towerControlPlaneHealth(),
  ]);
  const combinedLogs = [gatewayLogs, errorLogs]
    .flatMap((result) => result?.ok ? result.output.split(/\r?\n/) : [])
    .join("\n");
  return {
    gateway: "hermes" as const,
    healthy: status.ok && !/\b(failed|not running|unavailable)\b/i.test(status.output),
    status: status.ok ? { summary: status.output.slice(0, 8_000) } : { error: status.error },
    tower,
    logs: input.includeLogs === false
      ? null
      : {
          matchedTrace: Boolean(input.trace && combinedLogs.toLowerCase().includes(input.trace.toLowerCase())),
          lines: boundedLogLines(combinedLogs, input.trace),
          errors: [gatewayLogs, errorLogs].flatMap((result) => result && !result.ok ? [result.error] : []),
        },
  };
}
