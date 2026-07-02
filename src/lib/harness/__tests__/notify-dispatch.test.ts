import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { task: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/config-reader", () => ({ readConfigValue: vi.fn() }));
vi.mock("../notify/init", () => ({ ensureNotifyChannels: vi.fn() }));
vi.mock("../notify/registry", () => ({ dispatchNotification: vi.fn() }));

import { db } from "@/lib/db";
import { readConfigValue } from "@/lib/config-reader";
import { dispatchNotification } from "../notify/registry";
import { resolveNotifyBinding } from "../notify/resolve-binding";
import { notifyForTask } from "../notify/dispatch";

const mockDb = db as unknown as { task: { findUnique: ReturnType<typeof vi.fn> } };
const mockRead = readConfigValue as unknown as ReturnType<typeof vi.fn>;
const mockDispatch = dispatchNotification as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockRead.mockResolvedValue(null); // default sink absent unless overridden
});

describe("resolveNotifyBinding", () => {
  it("任务自身有绑定 → 直接用并解析 target", async () => {
    mockDb.task.findUnique.mockResolvedValueOnce({
      notifyChannel: "feishu",
      notifyTarget: JSON.stringify({ chatId: "oc_self" }),
      parentTaskId: "p1",
    });
    const b = await resolveNotifyBinding("t1");
    expect(b).toEqual({ channel: "feishu", target: { chatId: "oc_self" } });
    expect(mockDb.task.findUnique).toHaveBeenCalledTimes(1); // 命中即停，不再上溯
  });

  it("自身无绑定 → 沿 parentTaskId 上溯到祖先绑定", async () => {
    mockDb.task.findUnique
      .mockResolvedValueOnce({ notifyChannel: null, notifyTarget: null, parentTaskId: "p1" })
      .mockResolvedValueOnce({
        notifyChannel: "feishu",
        notifyTarget: JSON.stringify({ chatId: "oc_parent" }),
        parentTaskId: null,
      });
    const b = await resolveNotifyBinding("t1");
    expect(b).toEqual({ channel: "feishu", target: { chatId: "oc_parent" } });
  });

  it("链上都无绑定 → 落全局默认 sink", async () => {
    mockDb.task.findUnique.mockResolvedValueOnce({
      notifyChannel: null,
      notifyTarget: null,
      parentTaskId: null,
    });
    mockRead.mockResolvedValueOnce({ channel: "feishu", target: { chatId: "oc_default" } });
    const b = await resolveNotifyBinding("t1");
    expect(b).toEqual({ channel: "feishu", target: { chatId: "oc_default" } });
  });

  it("无绑定且无默认 sink → null", async () => {
    mockDb.task.findUnique.mockResolvedValueOnce({
      notifyChannel: null,
      notifyTarget: null,
      parentTaskId: null,
    });
    const b = await resolveNotifyBinding("t1");
    expect(b).toBeNull();
  });

  it("notifyTarget JSON 损坏 → 跳过该级继续上溯，不抛", async () => {
    mockDb.task.findUnique
      .mockResolvedValueOnce({ notifyChannel: "feishu", notifyTarget: "{bad", parentTaskId: "p1" })
      .mockResolvedValueOnce({
        notifyChannel: "feishu",
        notifyTarget: JSON.stringify({ chatId: "oc_parent" }),
        parentTaskId: null,
      });
    const b = await resolveNotifyBinding("t1");
    expect(b).toEqual({ channel: "feishu", target: { chatId: "oc_parent" } });
  });
});

describe("notifyForTask gating", () => {
  const base = {
    taskId: "t1",
    kind: "ask" as const,
    title: "T",
    body: "B",
    correlationId: "r1",
  };

  it("非 unattended → 不派发", async () => {
    const r = await notifyForTask({ ...base, unattended: false });
    expect(r.notified).toBe(false);
    expect(r.reason).toBe("not_unattended");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("全局 DND 开启 → 不派发", async () => {
    mockRead.mockResolvedValueOnce(true); // harness.dnd = true
    const r = await notifyForTask({ ...base, unattended: true });
    expect(r.notified).toBe(false);
    expect(r.reason).toBe("dnd");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("unattended + 有绑定 + dispatch 成功 → notified true", async () => {
    mockRead.mockResolvedValueOnce(false); // dnd
    mockDb.task.findUnique.mockResolvedValueOnce({
      notifyChannel: "feishu",
      notifyTarget: JSON.stringify({ chatId: "oc_1" }),
      parentTaskId: null,
    });
    mockDispatch.mockResolvedValueOnce(true);
    const r = await notifyForTask({ ...base, unattended: true });
    expect(r.notified).toBe(true);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "feishu",
        target: { chatId: "oc_1" },
        msg: expect.objectContaining({ kind: "ask", correlationId: "r1" }),
      })
    );
  });

  it("unattended 但无绑定 → notified false, reason no_binding", async () => {
    mockRead.mockResolvedValueOnce(false); // dnd
    mockDb.task.findUnique.mockResolvedValueOnce({
      notifyChannel: null,
      notifyTarget: null,
      parentTaskId: null,
    });
    mockRead.mockResolvedValueOnce(null); // default sink absent
    const r = await notifyForTask({ ...base, unattended: true });
    expect(r.notified).toBe(false);
    expect(r.reason).toBe("no_binding");
  });
});
