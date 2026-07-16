// @vitest-environment node
import { vi, describe, it, expect, beforeEach } from "vitest";

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

// A syntactically valid CUID (matches /^c[a-z0-9]{20,30}$/).
const TASK_ID = "claaaaaaaaaaaaaaaaaaaaaa";

beforeEach(() => {
  findUnique.mockReset();
  readCfg.mockReset();
  readCfg.mockResolvedValue([]);
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
    expect(r.error).toBe("taskId required");
  });

  it("task not found → error, does not default to work", async () => {
    findUnique.mockResolvedValue(null);
    const r = await call({ taskId: TASK_ID });
    expect(r.error).toBe("task not found");
    expect(r.scope).toBeUndefined();
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
