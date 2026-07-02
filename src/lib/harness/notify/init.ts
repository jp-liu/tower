import { readConfigValue } from "@/lib/config-reader";
import { CONFIG_DEFAULTS } from "@/lib/config-defaults";
import { registerChannel, hasChannel } from "./registry";
import { createFeishuChannel } from "./feishu-channel";
import { logger } from "@/lib/logger";

const log = logger.create("notify-init");

/**
 * 幂等 + 自愈地注册通知渠道。
 *
 * 在 instrumentation 启动钩子里调一次；harness 派发前也可再调一次兜底 —— 若渠道已注册直接跳过，
 * 未注册且此刻凭据齐了（用户在设置里填了）就补注册，无需重启。凭据来源：env `HARNESS_FEISHU_*`
 * 优先，其次 SystemConfig。best-effort：SDK 缺失/凭据缺失只 warn，不抛错。
 */
export async function ensureNotifyChannels(): Promise<void> {
  if (hasChannel("feishu")) return;

  const appId =
    process.env.HARNESS_FEISHU_APP_ID ||
    (await readConfigValue<string>("harness.feishu.appId", ""));
  const appSecret =
    process.env.HARNESS_FEISHU_APP_SECRET ||
    (await readConfigValue<string>("harness.feishu.appSecret", ""));
  if (!appId || !appSecret) return; // 未配置飞书 → 静默跳过（UI 内仍可见 pending）

  const domain =
    process.env.HARNESS_FEISHU_DOMAIN ||
    (await readConfigValue<string>(
      "harness.feishu.domain",
      CONFIG_DEFAULTS["harness.feishu.domain"].defaultValue as string
    ));

  try {
    registerChannel(createFeishuChannel({ appId, appSecret, domain }));
    log.info("feishu notify channel registered");
  } catch (e) {
    log.error("failed to register feishu notify channel", e);
  }
}
