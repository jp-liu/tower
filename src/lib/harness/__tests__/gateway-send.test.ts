// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config-reader", () => ({
  readConfigValue: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    systemConfig: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("@/lib/platform", () => ({
  ensurePathInEnv: (env: Record<string, string | undefined>) => env,
  resolveCommandPathSync: () => "openclaw",
}));

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readConfigValue } from "@/lib/config-reader";
import { db } from "@/lib/db";
import { resolveHarnessDestination, sendViaHarnessGateway } from "../gateway-send";

const readCfg = readConfigValue as unknown as ReturnType<typeof vi.fn>;
const readFileMock = readFile as unknown as ReturnType<typeof vi.fn>;
const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;
const upsertMock = db.systemConfig.upsert as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  readCfg.mockReset();
  readCfg.mockResolvedValue([]);
  upsertMock.mockReset();
  upsertMock.mockResolvedValue({});
  readFileMock.mockReset();
  readFileMock.mockRejectedValue(new Error("no directory"));
  execFileMock.mockReset();
  execFileMock.mockImplementation((_cmd, _args, _options, cb) => cb(new Error("no directory")));
  process.env.HERMES_PROFILE = "h-tower";
});

describe("resolveHarnessDestination", () => {
  it("normalizes Feishu chat ids for Hermes", async () => {
    const r = await resolveHarnessDestination({
      gateway: "hermes",
      downstream: "feishu",
      to: "oc_abc",
      scope: "work",
    });
    expect(r).toEqual({ ok: true, dest: "feishu:oc_abc" });
  });

  it("resolves configured aliases before falling back to raw names", async () => {
    readCfg.mockResolvedValue([
      { alias: "起飞", gateway: "hermes", platform: "feishu", dest: "feishu:oc_qifei", scope: "work" },
    ]);
    const r = await resolveHarnessDestination({
      gateway: "hermes",
      downstream: "feishu",
      to: "起飞群",
      scope: "work",
    });
    expect(r).toEqual({ ok: true, dest: "feishu:oc_qifei" });
  });

  it("allows multiple normalized aliases when they point to the same destination", async () => {
    readCfg.mockResolvedValue([
      { alias: "起飞", gateway: "openclaw", platform: "feishu", dest: "feishu:oc_qifei", scope: "work" },
      { alias: "起飞群", gateway: "openclaw", platform: "feishu", dest: "feishu:oc_qifei", scope: "work" },
    ]);
    const r = await resolveHarnessDestination({
      gateway: "openclaw",
      downstream: "feishu",
      to: "起飞群",
      scope: "work",
    });
    expect(r).toEqual({ ok: true, dest: "feishu:oc_qifei" });
  });

  it("uses Hermes channel directory when it has one exact match", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        platforms: {
          feishu: [{ id: "oc_dir", name: "起飞", type: "group" }],
        },
      }),
    );
    const r = await resolveHarnessDestination({
      gateway: "hermes",
      downstream: "feishu",
      to: "起飞",
      scope: "work",
    });
    expect(r).toEqual({ ok: true, dest: "feishu:oc_dir" });
  });

  it("uses OpenClaw group directory when a work group name has one exact match", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, cb) =>
      cb(null, JSON.stringify([{ kind: "group", id: "oc_nanzhao", name: "南招分班系统" }]), ""),
    );
    const r = await resolveHarnessDestination({
      gateway: "openclaw",
      downstream: "feishu",
      to: "南招分班系统群",
      scope: "work",
    });
    expect(r).toEqual({ ok: true, dest: "feishu:oc_nanzhao" });
    expect(upsertMock).toHaveBeenCalledWith({
      where: { key: "harness.destinations" },
      create: {
        key: "harness.destinations",
        value: JSON.stringify([
          {
            alias: "南招分班系统群",
            label: "南招分班系统",
            gateway: "openclaw",
            platform: "feishu",
            dest: "feishu:oc_nanzhao",
            scope: "work",
          },
        ]),
      },
      update: {
        value: JSON.stringify([
          {
            alias: "南招分班系统群",
            label: "南招分班系统",
            gateway: "openclaw",
            platform: "feishu",
            dest: "feishu:oc_nanzhao",
            scope: "work",
          },
        ]),
      },
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "openclaw",
      [
        "directory",
        "groups",
        "list",
        "--channel",
        "feishu",
        "--query",
        "南招分班系统群",
        "--json",
        "--limit",
        "10",
      ],
      expect.objectContaining({ timeout: 20_000 }),
      expect.any(Function),
    );
  });

  it("does not query OpenClaw directory for exact platform ids", async () => {
    const r = await resolveHarnessDestination({
      gateway: "openclaw",
      downstream: "feishu",
      to: "oc_exact",
      scope: "work",
    });
    expect(r).toEqual({ ok: true, dest: "feishu:oc_exact" });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("requires a destination for work messages", async () => {
    const r = await resolveHarnessDestination({
      gateway: "openclaw",
      downstream: "slack",
      scope: "work",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Work messages require a destination");
  });

  it("allows Hermes unattended home routes without a destination", async () => {
    const r = await resolveHarnessDestination({
      gateway: "hermes",
      downstream: "feishu",
      scope: "unattended",
    });
    expect(r).toEqual({ ok: true, dest: "feishu" });
  });

  it("uses the Hermes WeChat unattended home route even when an old destination exists", async () => {
    const r = await resolveHarnessDestination({
      gateway: "hermes",
      downstream: "wechat",
      dest: "weixin:old-cloudbot-id",
      to: "ignored",
      scope: "unattended",
    });
    expect(r).toEqual({ ok: true, dest: null });
  });
});

describe("sendViaHarnessGateway", () => {
  it("sends OpenClaw presentation cards without duplicating the text fallback", async () => {
    execFileMock.mockImplementation((_cmd, _args, _options, cb) =>
      cb(null, '{"message_id":"om_presentation"}', ""));

    const presentation = {
      title: "Tower",
      tone: "info",
      blocks: [
        { type: "text", text: "消息正文" },
        { type: "divider" },
        { type: "context", text: "[[tower:task=claaaaaaaaaaaaaaaaaaaaaa]]" },
      ],
    };
    const r = await sendViaHarnessGateway({
      gateway: "openclaw",
      downstream: "feishu",
      to: "oc_exact",
      message: "消息正文\n\n[[tower:task=claaaaaaaaaaaaaaaaaaaaaa]]",
      presentation,
      scope: "work",
    });

    expect(r.ok).toBe(true);
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).toContain("--presentation");
    expect(args).toContain("--json");
    expect(args).not.toContain("--message");
    expect(JSON.parse(args[args.indexOf("--presentation") + 1])).toEqual(presentation);
  });

  it("falls back to plain text when OpenClaw does not support presentation", async () => {
    execFileMock
      .mockImplementationOnce((_cmd, _args, _options, cb) => cb({ stderr: "unknown option --presentation" }))
      .mockImplementationOnce((_cmd, _args, _options, cb) =>
        cb(null, '{"message_id":"om_fallback"}', ""));

    const r = await sendViaHarnessGateway({
      gateway: "openclaw",
      downstream: "feishu",
      to: "oc_exact",
      message: "fallback body",
      presentation: { title: "Tower", blocks: [{ type: "text", text: "fallback body" }] },
      scope: "work",
    });

    expect(r.ok).toBe(true);
    expect(execFileMock).toHaveBeenCalledTimes(2);
    const fallbackArgs = execFileMock.mock.calls[1][1] as string[];
    expect(fallbackArgs).toContain("--message");
    expect(fallbackArgs).toContain("fallback body");
    expect(fallbackArgs).toContain("--json");
  });
});
