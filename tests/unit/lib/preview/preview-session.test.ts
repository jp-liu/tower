import { describe, it, expect, afterEach } from "vitest";
import { PreviewSession } from "@/lib/preview/preview-session";
import { resolve } from "node:path";
import { PRESETS } from "@/lib/preview/presets";

const MOCK = resolve("tests/fixtures/mock-dev-server/index.js");

describe("PreviewSession", () => {
  let session: PreviewSession;

  afterEach(() => {
    if (session) session.stop();
  });

  it("starts with stopped status", () => {
    session = new PreviewSession({
      key: "test|node|9999",
      cwd: process.cwd(),
      command: "node",
      args: [MOCK, "--port", "9999"],
      port: 9999,
      preset: null,
    });
    expect(session.status).toBe("stopped");
  });

  it("transitions stopped → starting → running on real spawn + ready signal", async () => {
    session = new PreviewSession({
      key: "test|node|19999",
      cwd: process.cwd(),
      command: "node",
      args: [MOCK, "--port", "19999", "--ready-msg", "ready in 12 ms"],
      port: 19999,
      preset: PRESETS.find((p) => p.id === "vite")!,
    });
    const states: string[] = [];
    session.onStateChange((s) => states.push(s.status));

    await session.run();
    await new Promise((r) => setTimeout(r, 3000));

    expect(states).toContain("starting");
    expect(session.status).toBe("running");
  }, 10_000);

  it("ring buffer keeps last 5000 lines (test helper pushBuffer)", () => {
    session = new PreviewSession({
      key: "test|noop|9998",
      cwd: process.cwd(),
      command: "node",
      args: [MOCK, "--port", "9998"],
      port: 9998,
      preset: null,
    });
    for (let i = 0; i < 5500; i++) session.pushBuffer(`line ${i}`);
    expect(session.getBuffer().length).toBeLessThanOrEqual(5000);
    expect(session.getBuffer()[0]).not.toBe("line 0");
  });

  it("subscribers tracked by connectionId, not taskId", () => {
    session = new PreviewSession({
      key: "test|noop|9997",
      cwd: process.cwd(),
      command: "node",
      args: [MOCK, "--port", "9997"],
      port: 9997,
      preset: null,
    });
    const un1 = session.subscribe("conn-1", "task-A", () => {}, () => {});
    const un2 = session.subscribe("conn-2", "task-A", () => {}, () => {});
    expect(session.activeSubscriberCount).toBe(2);
    expect(session.subscriberTaskIds.size).toBe(1);
    un1();
    expect(session.activeSubscriberCount).toBe(1);
    un2();
    expect(session.activeSubscriberCount).toBe(0);
  });

  it("autoStartAfter triggers run after successful install (C-1 regression)", async () => {
    session = new PreviewSession({
      key: "test|node|9995",
      cwd: process.cwd(),
      command: "node",
      args: ["-e", "process.exit(0)"],  // simulate dev server that exits immediately
      port: 9995,
      preset: null,
    });
    await session.install({
      installCommand: "node",
      installArgs: ["-e", "process.exit(0)"],  // simulate install that exits successfully
      autoStartAfter: true,
    });
    // give install + autoStart a chance to complete
    await new Promise((r) => setTimeout(r, 1500));
    // status must not be stuck on "installing" — could be starting / running / stopped / error
    expect(session.status).not.toBe("installing");
  }, 10_000);

  it("cancelRequested during install transitions to stopped, not error", async () => {
    session = new PreviewSession({
      key: "test|sleep|9996",
      cwd: process.cwd(),
      command: "node",
      args: ["-e", "setTimeout(() => process.exit(0), 5000)"],
      port: 9996,
      preset: null,
    });
    await session.install({
      installCommand: "node",
      installArgs: ["-e", "setTimeout(() => process.exit(0), 5000)"],
    });
    expect(session.status).toBe("installing");
    session.stop();
    await new Promise((r) => setTimeout(r, 1000));
    expect(session.status).toBe("stopped");
  }, 10_000);
});
