import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerChannel,
  dispatchNotification,
  __resetChannels,
} from "../notify/registry";

beforeEach(() => {
  __resetChannels();
});

describe("notify registry", () => {
  it("按 channel 路由到对应 adapter 并透传 target", async () => {
    const send = vi.fn().mockResolvedValue({ channelRef: "om_x" });
    registerChannel({ id: "feishu", send });

    const ok = await dispatchNotification({
      channel: "feishu",
      target: { chatId: "oc_1" },
      msg: { correlationId: "r1", taskId: "t1", kind: "ask", title: "问", body: "选 A?" },
    });

    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "r1", kind: "ask" }),
      { chatId: "oc_1" }
    );
  });

  it("渠道未注册 → 返回 false 不抛", async () => {
    const ok = await dispatchNotification({
      channel: "nope",
      target: {},
      msg: { correlationId: "r", taskId: "t", kind: "ask", title: "", body: "" },
    });
    expect(ok).toBe(false);
  });

  it("adapter send 抛错 → 捕获后返回 false（best-effort，不拖累主流程）", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network down"));
    registerChannel({ id: "feishu", send });

    const ok = await dispatchNotification({
      channel: "feishu",
      target: {},
      msg: { correlationId: "r", taskId: "t", kind: "failed", title: "x", body: "y" },
    });
    expect(ok).toBe(false);
  });

  it("同 id 重复注册以最后一个为准（幂等重启安全）", async () => {
    const first = vi.fn().mockResolvedValue({});
    const second = vi.fn().mockResolvedValue({});
    registerChannel({ id: "feishu", send: first });
    registerChannel({ id: "feishu", send: second });

    await dispatchNotification({
      channel: "feishu",
      target: {},
      msg: { correlationId: "r", taskId: "t", kind: "notify", title: "", body: "" },
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
