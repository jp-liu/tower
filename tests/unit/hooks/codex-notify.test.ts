// @vitest-environment node
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const scriptPath = path.join(process.cwd(), "scripts", "tower-codex-notify.js");
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("tower-codex-notify", () => {
  it("forwards Codex turn completion to Tower's Stop endpoint", async () => {
    let resolveBody: (body: unknown) => void = () => {};
    const received = new Promise<unknown>((resolve) => {
      resolveBody = resolve;
    });
    const server = createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf-8");
      request.on("data", (chunk) => { raw += chunk; });
      request.on("end", () => {
        expect(request.url).toBe("/api/internal/hooks/stop");
        resolveBody(JSON.parse(raw));
        response.writeHead(200).end("ok");
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP server did not bind");

    await execFileAsync(process.execPath, [
      scriptPath,
      JSON.stringify({
        type: "agent-turn-complete",
        "thread-id": "thread-123",
        "last-assistant-message": "Implemented and verified.",
      }),
    ], {
      env: {
        ...process.env,
        TOWER_TASK_ID: "task-123",
        TOWER_API_URL: `http://127.0.0.1:${address.port}`,
      },
    });

    await expect(received).resolves.toEqual({
      taskId: "task-123",
      sessionId: "thread-123",
      lastReply: "Implemented and verified.",
    });
  });
});

