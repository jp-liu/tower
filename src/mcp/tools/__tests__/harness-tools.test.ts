// @vitest-environment node
import { vi, describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { task: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/config-reader", () => ({
  readConfigValue: vi.fn(),
}));

import { harnessTools, parseGatewaySendOutput } from "../harness-tools";
import { db } from "@/lib/db";
import { readConfigValue } from "@/lib/config-reader";

const findUnique = db.task.findUnique as unknown as ReturnType<typeof vi.fn>;
const readCfg = readConfigValue as unknown as ReturnType<typeof vi.fn>;
const call = (args: { scope?: "work" | "unattended"; taskId?: string }) =>
  harnessTools.list_notify_targets.handler(args) as Promise<Record<string, unknown>>;
const pushToHuman = (args: {
  taskId?: string;
  message: string;
  scope?: "work" | "unattended";
  to?: string;
  expectReply?: boolean;
}) => harnessTools.push_to_human.handler(args) as Promise<Record<string, unknown>>;

// A syntactically valid CUID (matches /^c[a-z0-9]{20,30}$/).
const TASK_ID = "claaaaaaaaaaaaaaaaaaaaaa";
const OTHER_TASK_ID = "clbbbbbbbbbbbbbbbbbbbbbb";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("TOWER_TASK_ID", "");
  findUnique.mockReset();
  readCfg.mockReset();
  readCfg.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("list_notify_targets — taskId invariant", () => {
  it("no taskId → error, no sendable token", async () => {
    const r = await call({});
    expect(r.error).toBe("taskId required");
    expect(String(r.instructions)).not.toContain("[[tower:task=");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("non-CUID taskId → error", async () => {
    const r = await call({ taskId: "not-a-cuid" });
    expect(r.error).toBe("Invalid taskId format — expected CUID");
  });

  it("task not found → error, does not default to work", async () => {
    findUnique.mockResolvedValue(null);
    const r = await call({ taskId: TASK_ID });
    expect(r.error).toBe("task not found");
    expect(r.scope).toBeUndefined();
  });

  it("taskId different from current terminal env → error before DB lookup", async () => {
    vi.stubEnv("TOWER_TASK_ID", TASK_ID);
    const r = await call({ taskId: OTHER_TASK_ID });
    expect(r.error).toBe(`Task boundary mismatch — this terminal is bound to ${TASK_ID}, refusing to operate on ${OTHER_TASK_ID}`);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("no taskId + current terminal env → uses the env task id", async () => {
    vi.stubEnv("TOWER_TASK_ID", TASK_ID);
    findUnique.mockResolvedValue({ unattended: false, title: "T" });
    readCfg.mockResolvedValue([{ active: true, gateway: "openclaw", downstream: "feishu", scope: "work" }]);

    const r = await call({});

    expect(r.scope).toBe("work");
    expect(String(r.instructions)).toContain(`[[tower:task=${TASK_ID}]]`);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      select: { unattended: true, title: true },
    });
  });
});

describe("push_to_human — task boundary invariant", () => {
  it("rejects a different taskId before resolving channels or sending", async () => {
    vi.stubEnv("TOWER_TASK_ID", TASK_ID);
    const r = await pushToHuman({
      taskId: OTHER_TASK_ID,
      message: "状态同步",
      scope: "work",
      to: "起飞",
      expectReply: false,
    });

    expect(r).toEqual({
      error: `Task boundary mismatch — this terminal is bound to ${TASK_ID}, refusing to operate on ${OTHER_TASK_ID}`,
      taskId: OTHER_TASK_ID,
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(readCfg).not.toHaveBeenCalled();
  });

  it("allows explicit taskId when no task terminal env exists", async () => {
    findUnique.mockResolvedValue({ unattended: false, title: "T" });
    readCfg.mockResolvedValue([{ active: true, gateway: "not-supported", scope: "work" }]);

    const r = await pushToHuman({
      taskId: TASK_ID,
      message: "状态同步",
      scope: "work",
      to: "起飞",
      expectReply: false,
    });

    expect(r.error).toBe("push_to_human supports Hermes/OpenClaw channels only; active gateway is not-supported");
    expect(findUnique).toHaveBeenCalled();
  });

  it("uses TOWER_TASK_ID when taskId is omitted in a task terminal", async () => {
    vi.stubEnv("TOWER_TASK_ID", TASK_ID);
    findUnique.mockResolvedValue({ unattended: false, title: "T" });
    readCfg.mockResolvedValue([{ active: true, gateway: "not-supported", scope: "work" }]);

    const r = await pushToHuman({
      message: "状态同步",
      scope: "work",
      to: "起飞",
      expectReply: false,
    });

    expect(r.error).toBe("push_to_human supports Hermes/OpenClaw channels only; active gateway is not-supported");
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      select: { unattended: true, title: true },
    });
  });
});

describe("list_notify_targets — scope derivation", () => {
  it("goal mode on + no explicit scope → unattended", async () => {
    findUnique.mockResolvedValue({ unattended: true, title: "T" });
    readCfg.mockResolvedValue([
      { active: true, gateway: "hermes", downstream: "feishu", dest: "feishu:oc_test", scope: "unattended" },
    ]);
    const r = await call({ taskId: TASK_ID });
    expect(r.scope).toBe("unattended");
    expect(String(r.instructions)).toContain(`[[tower:task=${TASK_ID}]]`);
  });

  it("goal mode off + no explicit scope → work", async () => {
    findUnique.mockResolvedValue({ unattended: false, title: "T" });
    readCfg.mockResolvedValue([{ active: true, gateway: "openclaw", downstream: "slack", scope: "work" }]);
    const r = await call({ taskId: TASK_ID });
    expect(r.scope).toBe("work");
  });

  it("explicit scope overrides goal mode", async () => {
    findUnique.mockResolvedValue({ unattended: true, title: "T" });
    readCfg.mockResolvedValue([{ active: true, gateway: "openclaw", downstream: "slack", scope: "work" }]);
    const r = await call({ taskId: TASK_ID, scope: "work" });
    expect(r.scope).toBe("work");
  });

  it("legacy target without scope counts as unattended", async () => {
    findUnique.mockResolvedValue({ unattended: true, title: "T" });
    readCfg.mockResolvedValue([{ active: true, gateway: "hermes", dest: "feishu:oc_test" /* no scope */ }]);
    const r = await call({ taskId: TASK_ID });
    expect(r.scope).toBe("unattended");
    expect(r.noChannelConfigured).toBeUndefined();
    expect((r.active as { gateway?: string })?.gateway).toBe("hermes");
  });

  it("unattended Hermes channel without dest uses downstream home", async () => {
    findUnique.mockResolvedValue({ unattended: true, title: "T" });
    readCfg.mockResolvedValue([{ active: true, gateway: "hermes", downstream: "feishu", scope: "unattended" }]);
    const r = await call({ taskId: TASK_ID });
    expect(r.scope).toBe("unattended");
    expect(r.noChannelConfigured).toBeUndefined();
    expect(String(r.instructions)).toContain("feishu home channel");
  });

  it("work Hermes channel without fixed dest is sendable when push_to_human gets `to`", async () => {
    findUnique.mockResolvedValue({ unattended: false, title: "T" });
    readCfg.mockResolvedValue([{ active: true, gateway: "hermes", downstream: "feishu", scope: "work" }]);
    const r = await call({ taskId: TASK_ID });
    expect(r.scope).toBe("work");
    expect(r.noChannelConfigured).toBeUndefined();
    expect(String(r.instructions)).toContain("pass `to`");
  });

  it("no active channel of the derived scope → noChannelConfigured", async () => {
    findUnique.mockResolvedValue({ unattended: true, title: "T" });
    readCfg.mockResolvedValue([{ active: true, gateway: "openclaw", scope: "work" }]); // only work active
    const r = await call({ taskId: TASK_ID }); // derives unattended
    expect(r.scope).toBe("unattended");
    expect(r.noChannelConfigured).toBe(true);
  });
});

describe("gateway task boundary tools", () => {
  it("does not expose DIRECT in route_gateway_message", () => {
    const parsed = harnessTools.route_gateway_message.schema.safeParse({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_test",
      platformMessageId: "om_direct",
      intent: "DIRECT",
      content: "What time is it?",
    });

    expect(parsed.success).toBe(false);
  });

  it("returns task context without a second relay request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ mode: "task_context", taskId: TASK_ID }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await harnessTools.route_gateway_message.handler({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_test",
      platformMessageId: "om_context",
      replyToMessageId: "om_delivery",
      intent: "TOWER",
      content: "现在什么状态？",
    });

    expect(result).toEqual({ mode: "task_context", taskId: TASK_ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps legacy ordinary relay replies context-only", async () => {
    findUnique.mockResolvedValue({ id: TASK_ID, title: "Bound task", parentTaskId: null });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pending: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await harnessTools.relay_channel_reply.handler({
      taskId: TASK_ID,
      text: "现在什么状态？",
      platform: "feishu",
      chatId: "oc_test",
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "task_context",
      taskId: TASK_ID,
      resumed: false,
      continuationRequired: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/internal/harness/pending");
  });

  it("uses the side-effect-free context endpoint and explicit continuation endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bound: true, subjectTaskId: TASK_ID }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mode: "continued_task", taskId: TASK_ID }) });
    vi.stubGlobal("fetch", fetchMock);

    await harnessTools.resolve_gateway_task_context.handler({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_test",
      taskId: TASK_ID,
    });
    await harnessTools.continue_bound_task.handler({
      gateway: "openclaw",
      platform: "feishu",
      chatId: "oc_test",
      platformMessageId: "om_continue",
      taskId: TASK_ID,
      content: "继续修复",
    });

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/api/internal/harness/gateway-task");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:3000/api/internal/harness/gateway-task");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PUT" });
  });
});

describe("Workbench durable batch tools", () => {
  it("binds acknowledgement to the current Workbench task", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ batchId: "wb-123", state: "ACKED", eventCount: 1, noOp: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TOWER_TASK_ID", TASK_ID);

    await expect(harnessTools.ack_workbench_batch.handler({
      batchId: "wb-123",
      leaseToken: "lease-123",
    })).resolves.toMatchObject({
      state: "ACKED",
      noOp: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/internal/workbench/batch",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          action: "ack",
          parentTaskId: TASK_ID,
          batchId: "wb-123",
          leaseToken: "lease-123",
        }),
      }),
    );
  });

  it("rejects resolution outside a bound Workbench terminal", async () => {
    await expect(harnessTools.resolve_workbench_batch.handler({
      batchId: "wb-123",
      leaseToken: "lease-123",
    })).resolves.toEqual({
      error: "resolve_workbench_batch must run inside the bound Workbench terminal",
    });
  });
});

describe("parseGatewaySendOutput", () => {
  it("parses Hermes-style send JSON", () => {
    expect(
      parseGatewaySendOutput(
        JSON.stringify({
          platform: "feishu",
          chat_id: "oc_abc",
          message_id: "om_x100b6ab22dfd28a0386013615b78d2f",
        }),
      ),
    ).toEqual({
      platform: "feishu",
      chat_id: "oc_abc",
      message_id: "om_x100b6ab22dfd28a0386013615b78d2f",
    });
  });

  it("parses nested OpenClaw-style send JSON", () => {
    expect(
      parseGatewaySendOutput(
        JSON.stringify({
          action: "send",
          channel: "feishu",
          result: {
            target: "feishu:oc_abc",
            platformMessageId: "om_x100b6ab22dfd28a0386013615b78d2f",
          },
        }),
      ),
    ).toEqual({
      platform: "feishu",
      chat_id: "feishu:oc_abc",
      message_id: "om_x100b6ab22dfd28a0386013615b78d2f",
    });
  });

  it("parses human-readable fallback output", () => {
    expect(parseGatewaySendOutput("飞书消息 ID: om_x100b6ab22dfd28a0386013615b78d2f")).toEqual({
      message_id: "om_x100b6ab22dfd28a0386013615b78d2f",
    });
  });
});
