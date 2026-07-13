// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config-reader", () => ({
  readConfigValue: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import { readConfigValue } from "@/lib/config-reader";
import { resolveHarnessDestination } from "../gateway-send";

const readCfg = readConfigValue as unknown as ReturnType<typeof vi.fn>;
const readFileMock = readFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  readCfg.mockReset();
  readCfg.mockResolvedValue([]);
  readFileMock.mockReset();
  readFileMock.mockRejectedValue(new Error("no directory"));
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
