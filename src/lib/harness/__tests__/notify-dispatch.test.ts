import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { task: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/config-reader", () => ({ readConfigValue: vi.fn() }));
vi.mock("../notify/init", () => ({ ensureNotifyChannels: vi.fn() }));
vi.mock("../notify/registry", () => ({ dispatchNotification: vi.fn() }));
vi.mock("../harness-message", () => ({
  recordHarnessMessage: vi.fn(),
  markNotifyStatus: vi.fn(),
}));

import { db } from "@/lib/db";
import { readConfigValue } from "@/lib/config-reader";
import { dispatchNotification } from "../notify/registry";
import { markNotifyStatus } from "../harness-message";
import { resolveNotifyBinding } from "../notify/resolve-binding";
import { dispatchHarnessMessage } from "../notify/dispatch";

const mockDb = db as unknown as {
  task: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};
const mockRead = readConfigValue as unknown as ReturnType<typeof vi.fn>;
const mockDispatch = dispatchNotification as unknown as ReturnType<typeof vi.fn>;
const mockMark = markNotifyStatus as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockRead.mockResolvedValue(null);
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
    expect(mockDb.task.findUnique).toHaveBeenCalledTimes(1);
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

describe("dispatchHarnessMessage", () => {
  const base = {
    messageId: "h1",
    taskId: "t1",
    kind: "ask" as const,
    title: "T",
    body: "B",
  };
  const noWait = { retryDelaysMs: [0, 0, 0] };

  it("非 unattended → 不派发、不标状态", async () => {
    const r = await dispatchHarnessMessage({ ...base, unattended: false }, noWait);
    expect(r.notified).toBe(false);
    expect(r.reason).toBe("not_unattended");
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it("全局 DND → 不派发", async () => {
    mockRead.mockResolvedValueOnce(true);
    const r = await dispatchHarnessMessage({ ...base, unattended: true }, noWait);
    expect(r.notified).toBe(false);
    expect(r.reason).toBe("dnd");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("无绑定 → 标 FAILED，reason no_binding", async () => {
    mockRead.mockResolvedValueOnce(false); // dnd
    mockDb.task.findUnique.mockResolvedValueOnce({ notifyChannel: null, notifyTarget: null, parentTaskId: null });
    mockRead.mockResolvedValueOnce(null); // sink absent
    const r = await dispatchHarnessMessage({ ...base, unattended: true }, noWait);
    expect(r.notified).toBe(false);
    expect(r.reason).toBe("no_binding");
    expect(mockMark).toHaveBeenCalledWith("h1", "FAILED");
  });

  it("发送成功 → 标 SENT + 写反查键 notifyThreadRef", async () => {
    mockRead.mockResolvedValueOnce(false); // dnd
    mockDb.task.findUnique.mockResolvedValueOnce({
      notifyChannel: "feishu",
      notifyTarget: JSON.stringify({ chatId: "oc_1", threadId: "om_9" }),
      parentTaskId: null,
    });
    mockDispatch.mockResolvedValueOnce(true);
    const r = await dispatchHarnessMessage({ ...base, unattended: true }, noWait);
    expect(r.notified).toBe(true);
    expect(mockMark).toHaveBeenCalledWith("h1", "SENT", expect.objectContaining({ channel: "feishu" }));
    // 反查键用 threadId 优先
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "t1" },
      data: { notifyThreadRef: "feishu:om_9" },
    });
  });

  it("发送连续失败 3 次 → 标 FAILED，retry 用满次数", async () => {
    mockRead.mockResolvedValueOnce(false); // dnd
    mockDb.task.findUnique.mockResolvedValueOnce({
      notifyChannel: "feishu",
      notifyTarget: JSON.stringify({ chatId: "oc_1" }),
      parentTaskId: null,
    });
    mockDispatch.mockResolvedValue(false);
    const r = await dispatchHarnessMessage({ ...base, unattended: true }, noWait);
    expect(r.notified).toBe(false);
    expect(r.reason).toBe("dispatch_failed");
    expect(mockDispatch).toHaveBeenCalledTimes(3);
    expect(mockMark).toHaveBeenLastCalledWith("h1", "FAILED", expect.objectContaining({ channel: "feishu" }));
  });

  it("底层抛错 → 吞掉，标 FAILED，返回 error（记录路径不能被打断）", async () => {
    mockRead.mockRejectedValueOnce(new Error("db down"));
    const r = await dispatchHarnessMessage({ ...base, unattended: true }, noWait);
    expect(r.notified).toBe(false);
    expect(r.reason).toBe("error");
  });
});
