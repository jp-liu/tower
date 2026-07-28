import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeFeishuChatTarget,
  sendViaOpenClaw,
  verifyOpenClawFeishuReply,
} from "../openclaw-send";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function feishuConfig(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tower-openclaw-feishu-"));
  directories.push(directory);
  const path = join(directory, "openclaw.json");
  await writeFile(path, JSON.stringify({
    channels: { feishu: { appId: "cli_test", appSecret: "secret", domain: "https://feishu.test" } },
  }), "utf8");
  return path;
}

function authResponse() {
  return new Response(JSON.stringify({ code: 0, tenant_access_token: "token" }));
}

function receipt(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    code: 0,
    data: { items: [{
      message_id: "om_native_reply",
      chat_id: "oc_group",
      parent_id: "om_original",
      root_id: "om_original",
      msg_type: "interactive",
      ...overrides,
    }] },
  }));
}

describe("OpenClaw Feishu send adapter", () => {
  it.each([
    "chat:oc_group",
    "feishu:chat:oc_group",
    "feishu:oc_group",
    "oc_group",
  ])("normalizes equivalent Feishu chat target %s before receipt verification", async (dest) => {
    expect(normalizeFeishuChatTarget(dest)).toEqual({ ok: true, chatId: "oc_group" });
    const config = await feishuConfig();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(receipt());
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyOpenClawFeishuReply({
      messageId: "om_native_reply",
      replyToMessageId: "om_original",
      dest,
      env: { OPENCLAW_CONFIG_PATH: config },
    })).resolves.toMatchObject({
      ok: true,
      metadata: {
        chat_id: "oc_group",
        reply_to_message_id: "om_original",
        msg_type: "interactive",
      },
    });
  });

  it.each(["", "feishu:user:ou_user", "chat:not_a_chat", "oc_"])(
    "rejects an empty or invalid Feishu target %j without network access",
    async (dest) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      expect(normalizeFeishuChatTarget(dest)).toMatchObject({ ok: false });
      await expect(verifyOpenClawFeishuReply({
        messageId: "om_native_reply",
        replyToMessageId: "om_original",
        dest,
      })).resolves.toMatchObject({ ok: false });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("sends the preserved presentation through Feishu native interactive reply API", async () => {
    const config = await feishuConfig();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: {
          message_id: "om_native_reply",
          chat_id: "oc_group",
          parent_id: "om_original",
          msg_type: "interactive",
        },
      })))
      .mockResolvedValueOnce(receipt());
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendViaOpenClaw({
      message: "fallback text must not replace the card",
      presentation: {
        title: "小塔 · 项目讨论",
        tone: "info",
        blocks: [
          { type: "text", text: "Card body" },
          { type: "divider" },
          { type: "context", text: "Project context" },
        ],
      },
      downstream: "feishu",
      dest: "feishu:chat:oc_group",
      replyToMessageId: "om_original",
      threadId: "om_root_must_not_replace_parent",
      env: { OPENCLAW_CONFIG_PATH: config },
    })).resolves.toMatchObject({
      ok: true,
      metadata: {
        message_id: "om_native_reply",
        chat_id: "oc_group",
        reply_to_message_id: "om_original",
        msg_type: "interactive",
        send_mode: "reply",
      },
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://feishu.test/open-apis/im/v1/messages/om_original/reply",
    );
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload).toMatchObject({ msg_type: "interactive" });
    const card = JSON.parse(payload.content);
    expect(card.header.title.content).toBe("小塔 · 项目讨论");
    expect(JSON.stringify(card.elements)).toContain("Card body");
    expect(String(request.body)).not.toContain("fallback text must not replace the card");
  });

  it.each([
    [{ parent_id: undefined }, "receipt is not a native reply"],
    [{ parent_id: "om_wrong" }, "receipt is not a native reply"],
    [{ msg_type: "text" }, "receipt message type mismatch"],
    [{ chat_id: "oc_wrong" }, "receipt chat mismatch"],
  ] as const)("rejects a sent message when receipt contract is invalid: %j", async (overrides, error) => {
    const config = await feishuConfig();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(receipt(overrides)));

    await expect(verifyOpenClawFeishuReply({
      messageId: "om_native_reply",
      replyToMessageId: "om_original",
      dest: "oc_group",
      env: { OPENCLAW_CONFIG_PATH: config },
    })).resolves.toMatchObject({ ok: false, error: expect.stringContaining(error) });
  });

  it("returns the real receipt evidence when a native API send violates the reply contract", async () => {
    const config = await feishuConfig();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { message_id: "om_native_reply", parent_id: "om_original", msg_type: "interactive" },
      })))
      .mockResolvedValueOnce(receipt({ parent_id: "om_wrong" })));

    await expect(sendViaOpenClaw({
      message: "must remain a card",
      presentation: { title: "Card", tone: "info", blocks: [{ type: "text", text: "body" }] },
      downstream: "feishu",
      dest: "oc_group",
      replyToMessageId: "om_original",
      env: { OPENCLAW_CONFIG_PATH: config },
    })).resolves.toMatchObject({
      ok: false,
      metadata: {
        message_id: "om_native_reply",
        chat_id: "oc_group",
        reply_to_message_id: "om_wrong",
        msg_type: "interactive",
      },
      output: expect.stringContaining("native reply verification failed"),
    });
  });
});
