import "server-only";

import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@/lib/logger";
import { getSignalDir } from "@/lib/tower-dir";

const PREFIX = "provider-completion-";
const log = logger.create("provider-completion-recovery");
let recoveryRunning = false;

interface PendingCompletion {
  version: 1;
  provider: "codex";
  body: {
    taskId: string;
    executionId: string;
    sessionId?: string;
    eventId: string;
    lastReply?: string;
  };
}

function isPendingCompletion(value: unknown): value is PendingCompletion {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PendingCompletion>;
  const body = record.body;
  return record.version === 1 && record.provider === "codex" && Boolean(
    body
    && typeof body.taskId === "string" && body.taskId.trim()
    && typeof body.executionId === "string" && body.executionId.trim()
    && typeof body.eventId === "string" && body.eventId.trim(),
  );
}

async function post(pathname: string, body: unknown, baseUrl?: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl ?? `http://localhost:${process.env.PORT || "3000"}`}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function recoverPendingProviderCompletions(
  limit = 100,
  options: { signalDir?: string; baseUrl?: string } = {},
): Promise<{
  scanned: number;
  recovered: number;
  failed: number;
}> {
  if (recoveryRunning) return { scanned: 0, recovered: 0, failed: 0 };
  recoveryRunning = true;
  try {
    const signalDir = options.signalDir ?? getSignalDir();
    const names = (await readdir(signalDir).catch(() => []))
      .filter((name) => name.startsWith(PREFIX) && name.endsWith(".json"))
      .sort()
      .slice(0, limit);
    let recovered = 0;
    let failed = 0;
    for (const name of names) {
      const filePath = join(signalDir, name);
      let record: PendingCompletion;
      try {
        const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
        if (!isPendingCompletion(parsed)) {
          failed++;
          log.warn(`Ignored invalid provider completion record ${name}`);
          continue;
        }
        record = parsed;
      } catch (error) {
        failed++;
        log.warn(`Could not read provider completion record ${name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (record.body.sessionId) {
        await post("/api/internal/hooks/session", {
          taskId: record.body.taskId,
          sessionId: record.body.sessionId,
        }, options.baseUrl);
      }
      if (await post("/api/internal/hooks/stop", record.body, options.baseUrl)) {
        await unlink(filePath).catch(() => {});
        recovered++;
      } else {
        failed++;
      }
    }
    if (recovered > 0 || failed > 0) {
      log.info(`Provider completion recovery scanned ${names.length}; recovered ${recovered}, failed ${failed}`);
    }
    return { scanned: names.length, recovered, failed };
  } finally {
    recoveryRunning = false;
  }
}
