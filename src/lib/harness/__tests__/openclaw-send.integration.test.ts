import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { sendViaOpenClaw } from "../openclaw-send";

const previousCli = process.env.OPENCLAW_CLI_PATH;

afterEach(() => {
  if (previousCli === undefined) delete process.env.OPENCLAW_CLI_PATH;
  else process.env.OPENCLAW_CLI_PATH = previousCli;
});

describe("OpenClaw send adapter integration", () => {
  it("degrades presentation to text while preserving and confirming the native reply target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tower-openclaw-"));
    const cli = join(dir, "openclaw");
    const calls = join(dir, "calls");
    await writeFile(cli, `#!/bin/sh
printf '%s\\n' "$*" >> "${calls}"
case "$*" in
  *--presentation*) echo "unknown option --presentation" >&2; exit 2 ;;
esac
echo '{"channel":"feishu","message_id":"om_native_reply"}'
`, "utf8");
    await chmod(cli, 0o755);
    process.env.OPENCLAW_CLI_PATH = cli;

    await expect(sendViaOpenClaw({
      message: "fallback text",
      presentation: { title: "card" },
      downstream: "feishu",
      dest: "feishu:oc_group",
      replyToMessageId: "om_original",
    })).resolves.toMatchObject({
      ok: true,
      metadata: {
        message_id: "om_native_reply",
        reply_to_message_id: "om_original",
        send_mode: "reply",
      },
    });
    const invocations = await readFile(calls, "utf8");
    expect(invocations.split("\n").filter(Boolean)).toHaveLength(2);
    expect(invocations.split("\n").filter(Boolean).every((line) =>
      line.includes("--reply-to om_original"),
    )).toBe(true);
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
