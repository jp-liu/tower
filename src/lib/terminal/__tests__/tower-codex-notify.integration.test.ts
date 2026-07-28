import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { recoverPendingProviderCompletions } from "@/lib/terminal/provider-completion-recovery";

const execFileAsync = promisify(execFile);
const previousPort = process.env.PORT;

afterEach(() => {
  if (previousPort === undefined) delete process.env.PORT;
  else process.env.PORT = previousPort;
});

describe("Codex v0.145.0 completion notify integration", () => {
  it("persists before posting and converges a failed local callback by replay", async () => {
    let fail = true;
    const received: Array<{ path: string; body: Record<string, unknown> }> = [];
    const server = createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        received.push({ path: request.url ?? "", body: JSON.parse(raw) as Record<string, unknown> });
        response.statusCode = fail ? 503 : 200;
        response.end(JSON.stringify({ ok: !fail }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind");
    process.env.PORT = String(address.port);
    const signalDir = await mkdtemp(join(tmpdir(), "tower-codex-notify-"));
    const payload = JSON.stringify({
      type: "agent-turn-complete",
      "thread-id": "019fa654-48b5-7da2-b480-aacccea72441",
      "turn-id": "codex-v0.145.0-turn-1",
      "last-assistant-message": "6662049",
    });

    try {
      await execFileAsync(process.execPath, [join(process.cwd(), "scripts/tower-codex-notify.js"), payload], {
        env: {
          ...process.env,
          TOWER_TASK_ID: "task-codex-real",
          TOWER_EXECUTION_ID: "execution-codex-real",
          TOWER_API_URL: `http://127.0.0.1:${address.port}`,
          TOWER_SIGNAL_DIR: signalDir,
        },
        timeout: 8_000,
      });
      expect((await readdir(signalDir)).filter((name) => name.startsWith("provider-completion-")))
        .toHaveLength(1);

      fail = false;
      await expect(recoverPendingProviderCompletions(100, {
        signalDir,
        baseUrl: `http://127.0.0.1:${address.port}`,
      }))
        .resolves.toEqual({ scanned: 1, recovered: 1, failed: 0 });
      expect((await readdir(signalDir)).filter((name) => name.startsWith("provider-completion-")))
        .toHaveLength(0);
      expect(received.at(-1)).toEqual({
        path: "/api/internal/hooks/stop",
        body: expect.objectContaining({
          taskId: "task-codex-real",
          executionId: "execution-codex-real",
          sessionId: "019fa654-48b5-7da2-b480-aacccea72441",
          eventId: "codex-v0.145.0-turn-1",
          lastReply: "6662049",
        }),
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(signalDir, { recursive: true, force: true });
    }
  }, 10_000);
});
