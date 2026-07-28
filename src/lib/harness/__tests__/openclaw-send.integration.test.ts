import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendViaOpenClaw } from "../openclaw-send";

const previousCli = process.env.OPENCLAW_CLI_PATH;

afterEach(() => {
  if (previousCli === undefined) delete process.env.OPENCLAW_CLI_PATH;
  else process.env.OPENCLAW_CLI_PATH = previousCli;
  vi.unstubAllGlobals();
});

describe("OpenClaw send adapter integration", () => {
  it("degrades presentation to text while preserving and confirming the native reply target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-openclaw-"));
    const cli = join(dir, "openclaw");
    const calls = join(dir, "calls");
    const config = join(dir, "openclaw.json");
    await writeFile(config, JSON.stringify({
      channels: { feishu: { appId: "cli_test", appSecret: "secret", domain: "https://feishu.test" } },
    }), "utf8");
    await writeFile(cli, `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
case "$*" in
  *--presentation*) echo "unknown option --presentation" >&2; exit 2 ;;
esac
echo '{"channel":"feishu","message_id":"om_native_reply"}'
`, "utf8");
    await chmod(cli, 0o755);
    process.env.OPENCLAW_CLI_PATH = cli;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "token" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { items: [{
          message_id: "om_native_reply",
          chat_id: "oc_group",
          parent_id: "om_original",
          root_id: "om_original",
        }] },
      })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendViaOpenClaw({
      message: "fallback text",
      presentation: { title: "card" },
      downstream: "feishu",
      dest: "feishu:oc_group",
      replyToMessageId: "om_original",
      env: { OPENCLAW_CONFIG_PATH: config },
    })).resolves.toMatchObject({
      ok: true,
      metadata: {
        message_id: "om_native_reply",
        reply_to_message_id: "om_original",
        send_mode: "reply",
      },
    });
    const invocations = await readFile(calls, "utf8");
    expect(invocations.split("\n").filter(Boolean)).toHaveLength(1);
    expect(invocations.split("\n").filter(Boolean).every((line) =>
      line.includes("--reply-to om_original"),
    )).toBe(true);
    expect(invocations).not.toContain("--presentation");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://feishu.test/open-apis/im/v1/messages/om_native_reply");
  });

  it("rejects a successful OpenClaw send when the platform receipt is top-level", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-openclaw-"));
    const cli = join(dir, "openclaw");
    const config = join(dir, "openclaw.json");
    await writeFile(config, JSON.stringify({
      channels: { feishu: { appId: "cli_test", appSecret: "secret", domain: "https://feishu.test" } },
    }), "utf8");
    await writeFile(cli, "#!/bin/sh\necho '{\"channel\":\"feishu\",\"message_id\":\"om_top_level\"}'\n", "utf8");
    await chmod(cli, 0o755);
    process.env.OPENCLAW_CLI_PATH = cli;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "token" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        data: { items: [{ message_id: "om_top_level", chat_id: "oc_group" }] },
      }))));

    await expect(sendViaOpenClaw({
      message: "must be anchored",
      downstream: "feishu",
      dest: "feishu:oc_group",
      replyToMessageId: "om_original",
      env: { OPENCLAW_CONFIG_PATH: config },
    })).resolves.toMatchObject({
      ok: false,
      metadata: { message_id: "om_top_level" },
      output: expect.stringContaining("receipt is not a native reply"),
    });
  });

  it("does not retry through an unanchored compatibility command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-openclaw-"));
    const cli = join(dir, "openclaw");
    const calls = join(dir, "calls");
    await writeFile(cli, `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
echo "unknown option --reply-to" >&2
exit 2
`, "utf8");
    await chmod(cli, 0o755);
    process.env.OPENCLAW_CLI_PATH = cli;

    await expect(sendViaOpenClaw({
      message: "must remain anchored",
      downstream: "feishu",
      dest: "feishu:oc_group",
      replyToMessageId: "om_original",
    })).resolves.toMatchObject({ ok: false });
    expect((await readFile(calls, "utf8")).split("\n").filter(Boolean)).toHaveLength(1);
  });
});
