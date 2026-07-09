// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  channelLabel,
  hasSourceSection,
  parseTaskSourceBlock,
  renderBridgeSource,
  resolveTaskSource,
} from "../task-source";

describe("channelLabel", () => {
  it("maps known channels to localized prefixes", () => {
    expect(channelLabel("feishu", "招生群")).toBe("飞书群「招生群」");
    expect(channelLabel("wechat", "客户群")).toBe("微信群「客户群」");
    expect(channelLabel("wecom", "内部群")).toBe("企业微信群「内部群」");
  });
  it("is case-insensitive on the channel key", () => {
    expect(channelLabel("Feishu", "群")).toBe("飞书群「群」");
  });
  it("falls back to the raw channel for unknown values", () => {
    expect(channelLabel("discord", "chan")).toBe("discord「chan」");
  });
  it("omits the quoted name when there is no chatName", () => {
    expect(channelLabel("manual")).toBe("手动创建");
  });
});

describe("hasSourceSection", () => {
  it("detects an existing 来源 heading", () => {
    expect(hasSourceSection("## 目标\nx\n\n## 来源\n无")).toBe(true);
    expect(hasSourceSection("## 来源")).toBe(true);
  });
  it("returns false when absent", () => {
    expect(hasSourceSection("## 目标\nx")).toBe(false);
  });
});

describe("parseTaskSourceBlock", () => {
  const body = `
channel: feishu
chat_name: 南京招生报名讨论群
chat_id: oc_123
occurred_at: 2026-06-16 17:49 +08:00
chat_link: https://applink.feishu.cn/x
trigger_message_id: om_abc
thread_root_id: om_root
bridge: hermes
participants:
  - name: 张斯佳, open_id: ou_a, role: 讨论
  - name: 刘俊平, open_id: ou_c, role: 确认
transcript: |
  17:49 张斯佳：有线下核验点
  17:5x 刘俊平：可以处理
summary: 确认合并提示语后处理
`;

  it("parses flat fields, participants and transcript", () => {
    const data = parseTaskSourceBlock(body)!;
    expect(data.channel).toBe("feishu");
    expect(data.chatName).toBe("南京招生报名讨论群");
    expect(data.chatId).toBe("oc_123");
    expect(data.triggerMessageId).toBe("om_abc");
    expect(data.threadRootId).toBe("om_root");
    expect(data.bridge).toBe("hermes");
    expect(data.summary).toBe("确认合并提示语后处理");
    expect(data.participants).toEqual(["张斯佳", "刘俊平"]);
    expect(data.transcript).toBe("17:49 张斯佳：有线下核验点\n17:5x 刘俊平：可以处理");
  });

  it("returns null when channel is missing (the one required anchor)", () => {
    expect(parseTaskSourceBlock("chat_name: 群\nchat_id: oc_x")).toBeNull();
  });
});

describe("renderBridgeSource", () => {
  it("renders only present, deterministic fields with mapped channel", () => {
    const out = renderBridgeSource({
      channel: "feishu",
      chatName: "招生群",
      occurredAt: "2026-06-16 17:49",
      chatId: "oc_1",
      triggerMessageId: "om_1",
      bridge: "hermes",
      participants: ["张三", "李四"],
      summary: "结论",
      transcript: "17:49 张三：hi",
    });
    expect(out).toContain("- 渠道：飞书群「招生群」");
    expect(out).toContain("- 传输：hermes");
    expect(out).toContain("- 时间：2026-06-16 17:49");
    expect(out).toContain("- 参与者：张三、李四");
    expect(out).toContain("- 讨论要点：结论");
    expect(out).toContain("- 溯源 ID：chat=oc_1 · msg=om_1");
    expect(out).toContain("讨论摘录（按时间）：\n17:49 张三：hi");
    expect(out.startsWith("## 来源")).toBe(true);
  });

  it("omits lines whose data is absent", () => {
    const out = renderBridgeSource({ channel: "wechat", chatName: "群" });
    expect(out).toContain("- 渠道：微信群「群」");
    expect(out).not.toContain("时间");
    expect(out).not.toContain("溯源");
    expect(out).not.toContain("传输");
  });
});

describe("resolveTaskSource", () => {
  it("appends `## 来源\\n无` for a described task with no source", () => {
    const out = resolveTaskSource("## 目标\n做事", null);
    expect(out).toBe("## 目标\n做事\n\n## 来源\n\n无");
  });

  it("leaves an existing `## 来源` untouched", () => {
    const desc = "## 目标\nx\n\n## 来源\n无";
    expect(resolveTaskSource(desc, null)).toBe(desc);
  });

  it("leaves undefined description untouched when there is no source or parent", () => {
    expect(resolveTaskSource(undefined, null)).toBeUndefined();
  });

  it("appends parent-derivation source for a child task", () => {
    const out = resolveTaskSource("## 目标\nx", { id: "cparent", title: "父任务标题" })!;
    expect(out).toContain("- 渠道：父任务派生");
    expect(out).toContain("- 父任务：父任务标题（id: cparent）");
  });

  it("records the parent even when the child has no description", () => {
    const out = resolveTaskSource(undefined, { id: "cparent" })!;
    expect(out).toBe("## 来源\n\n- 渠道：父任务派生\n- 父任务：id: cparent");
  });

  it("does not double-add parent source when a `## 来源` already exists", () => {
    const desc = "## 目标\nx\n\n## 来源\n无";
    expect(resolveTaskSource(desc, { id: "cp", title: "P" })).toBe(desc);
  });

  it("strips a raw <task-source> block and renders a channel-generic source", () => {
    const desc = `## 目标\nx\n\n<task-source>\nchannel: wechat\nchat_name: 客户群\nchat_id: oc_9\ntrigger_message_id: om_9\ntranscript: |\n  10:00 A：需求\n</task-source>`;
    const out = resolveTaskSource(desc, null)!;
    expect(out).not.toContain("<task-source>");
    expect(out).toContain("## 目标\nx");
    expect(out).toContain("- 渠道：微信群「客户群」");
    expect(out).toContain("- 溯源 ID：chat=oc_9 · msg=om_9");
    expect(out).toContain("10:00 A：需求");
  });

  it("strips the raw block but keeps the model's own rendered source if present", () => {
    const desc = `## 来源\n无\n\n<task-source>\nchannel: feishu\nchat_id: oc_1\n</task-source>`;
    const out = resolveTaskSource(desc, null)!;
    expect(out).not.toContain("<task-source>");
    expect(out).toContain("## 来源\n无");
    expect(out).not.toContain("飞书群");
  });

  it("strips EVERY <task-source> block, not just the first (never store raw)", () => {
    const desc = `## 目标\nx\n\n<task-source>\nchannel: feishu\nchat_id: oc_1\n</task-source>\n\n<task-source>\nchannel: wechat\nchat_id: oc_2\n</task-source>`;
    const out = resolveTaskSource(desc, null)!;
    // No raw block of any kind survives — the second block must not leak through.
    expect(out).not.toContain("<task-source>");
    expect(out).not.toContain("oc_2");
    // The first (intended) block is the one rendered into `## 来源`.
    expect(out).toContain("- 溯源 ID：chat=oc_1");
  });
});
