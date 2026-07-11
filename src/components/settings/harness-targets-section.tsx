"use client";

import { useState, useEffect, useTransition } from "react";
import { Plus, Trash2, Pencil, Check, Loader2, Info, Copy, ExternalLink, Send, CircleCheck, CircleX, CircleDot, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import { testHarnessTarget, getHarnessSetupInfo } from "@/actions/harness-actions";

/** Gateways that run the agent themselves, so they need Tower's MCP + skill wired in. */
const MCP_GATEWAYS = new Set(["openclaw", "hermes"]);
interface HarnessSetupInfo {
  mcp: { name: string; command: string; args: string[]; env: Record<string, string> };
  skillDir: string;
}

/**
 * Unattended send-channel registry. Tower only **stores** this table, it never sends.
 * Each row is a "gateway → downstream" route: gateway (Feishu MCP / OpenClaw / Hermes) +
 * downstream (terminal channel). The destination (group/person) is stated at send time.
 */
export interface NotifyTarget {
  id: string;
  gateway: string;
  downstream: string;
  active: boolean; // single-select: only the active row is used by the agent for outbound
}

const GATEWAYS = ["feishu", "openclaw", "hermes"];
// Downstream channels each gateway supports (from openclaw / hermes docs, non-exhaustive; rest go via "custom").
const DS_BY_GATEWAY: Record<string, string[]> = {
  feishu: ["feishu"],
  openclaw: ["telegram", "signal", "whatsapp", "discord", "slack", "imessage"],
  hermes: [
    "telegram", "discord", "slack", "whatsapp", "signal",
    "feishu", "wechat", "wecom", "dingtalk", "qq", "matrix", "email",
  ],
};
const KNOWN_DS = [...new Set(Object.values(DS_BY_GATEWAY).flat())];
const CUSTOM = "__custom__";
const allowsCustom = (gw: string) => gw !== "feishu";
const dsOptions = (gw: string) => DS_BY_GATEWAY[gw] ?? [];

// Each platform's open-console / docs URL.
const DOCS: Record<string, string> = {
  feishu: "https://open.feishu.cn/",
  openclaw: "https://docs.openclaw.ai/",
  hermes: "https://hermes-agent.nousresearch.com/docs/",
};

// One-shot setup prompt handed to an AI (defaults to Feishu; OpenClaw / Hermes noted at the end).
// Kept in sync with the create-bot prompt in the "Feishu assistant bot" onboarding doc —
// the same app serves both unattended notifications and the Feishu assistant.
const SETUP_PROMPT = [
  "你有 Playwright（浏览器自动化）能力。帮我在飞书创建一个自建应用（机器人），用于 Tower 的无人值守通知与飞书助理。请一步步来；遇到需要我登录/扫码/人工确认的地方，停下来让我操作，我弄好再继续。",
  "",
  "平台地址：公网飞书 https://open.feishu.cn/ （公司/私有化飞书换成你们自己的内网开放平台地址）。用 Playwright 打开它，让我登录（企业管理员或开发者账号）。控制台页面可能有 WAF，但你是真实浏览器，正常访问即可。",
  "",
  "步骤：",
  "1. 创建企业自建应用：名字填「Tower 助理」，随便传个图标。",
  "2. 开启机器人能力：应用内「添加应用能力」→ 启用「机器人」。（不开这个，机器人进不了群、发不了消息。）",
  "3. 开通权限（「权限管理」逐个搜索并勾选，名称各版本略有差异，按含义找）：",
  "   必需：im:message（读写单聊/群消息）、im:message.group_msg（读群里全部消息，机器人收到 @ 靠它）、im:chat（获取群信息）、im:chat.members:read（读群成员、识别「谁 @ 我」）。",
  "   可选：task:task、wiki:wiki:readonly / wiki:node:read / wiki:node:retrieve、docx:document:readonly、drive:drive:readonly（要建飞书待办、读飞书文档/知识库才需要）。",
  "4. 发布版本：改完权限必须「创建版本 → 申请发布 / 上线」，否则权限不生效（最容易忘的一步）。等发布成功。",
  "5. 取凭据：到「凭证与基础信息」，复制 App ID（cli_ 开头）和 App Secret；并取机器人自己的 open_id（botOpenId，拿不到就标「待补」）。",
  "6. 建议新建一个唯一名称的专属群（如「Tower 通知」），把机器人加进去，记下群 id —— 避免同名群/人导致发错。",
  "7. 把 appId / appSecret / domain 配到飞书 MCP，并在 Tower「设置 → 通知 → 无人值守发送渠道」加一条渠道，点「测试」验证能收到消息。",
  "",
  "避坑：① 域名别搞反 —— 公司飞书和公网飞书是两套、凭据不通用；② 只「建了应用」不等于能用，必须开机器人能力 + 发布版本 + 拉进群三样齐；③ 别用 curl 直接抓控制台页面（有 WAF 会 403），用浏览器（Playwright）操作。",
  "",
  "（换 OpenClaw / Hermes 等其它网关：参考各自文档 https://docs.openclaw.ai/ · https://hermes-agent.nousresearch.com/docs/ ，拿到 token / webhook 后同样在 Tower 加渠道并测试。）",
].join("\n");

export function HarnessTargetsSection() {
  const { t } = useI18n();
  const tk = (k: string) => t(k as Parameters<typeof t>[0]);
  const [targets, setTargets] = useState<NotifyTarget[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customIds, setCustomIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, startSave] = useTransition();

  // Test state (one row at a time)
  const [testDest, setTestDest] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; output: string } | null>(null);

  // This machine's real MCP config + skill path — used for openclaw/hermes copyable integration prompt.
  const [setupInfo, setSetupInfo] = useState<HarnessSetupInfo | null>(null);
  useEffect(() => {
    getHarnessSetupInfo().then(setSetupInfo).catch(() => {});
  }, []);

  useEffect(() => {
    getConfigValue<NotifyTarget[]>("harness.targets", [])
      .then((v) => {
        const rows: NotifyTarget[] = (Array.isArray(v) ? v : []).map((r) => ({
          id: r.id ?? crypto.randomUUID(),
          gateway: GATEWAYS.includes(r.gateway) ? r.gateway : "feishu",
          downstream: r.downstream ?? "feishu",
          active: !!r.active,
        }));
        // Ensure exactly one row is active when any exist (default to the first).
        if (rows.length > 0 && !rows.some((r) => r.active)) rows[0].active = true;
        setTargets(rows);
        setCustomIds(
          new Set(rows.filter((r) => r.downstream && !KNOWN_DS.includes(r.downstream)).map((r) => r.id))
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const patch = (id: string, p: Partial<NotifyTarget>) =>
    setTargets((ts) => ts.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const addTarget = () => {
    const id = crypto.randomUUID();
    // First row is auto-activated.
    setTargets((ts) => [...ts, { id, gateway: "feishu", downstream: "feishu", active: ts.length === 0 }]);
    setEditingId(id);
    setTestResult(null);
  };

  // Single-select active: mark one row active, clear the rest.
  const setActive = (id: string) =>
    setTargets((ts) => ts.map((x) => ({ ...x, active: x.id === id })));

  const removeTarget = (id: string) => {
    setTargets((ts) => {
      const wasActive = ts.find((x) => x.id === id)?.active;
      const rest = ts.filter((x) => x.id !== id);
      // Removing the active row → activate the first remaining one.
      if (wasActive && rest.length > 0 && !rest.some((x) => x.active)) rest[0].active = true;
      return rest;
    });
    if (editingId === id) setEditingId(null);
  };

  const setCustom = (id: string, on: boolean) =>
    setCustomIds((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = () =>
    startSave(async () => {
      await setConfigValue("harness.targets", targets);
      setEditingId(null);
      toast.success(t("settings.harness.saved"));
    });

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_PROMPT);
      toast.success(t("settings.harness.copied"));
    } catch {
      toast.error(t("settings.harness.copyFailed"));
    }
  };

  // openclaw/hermes are "gateways that run the agent", so they must wire in Tower's MCP + skill.
  // This prompt carries the machine's real MCP command and skill path; hand it to that gateway's AI
  // to follow (same machine, stdio).
  const buildGatewayPrompt = (gw: string): string => {
    const gl = tk(`settings.harness.gateway.${gw}`);
    const mcpBlock = setupInfo
      ? [
          `   name: ${setupInfo.mcp.name}`,
          `   command: ${setupInfo.mcp.command}`,
          `   args: ${JSON.stringify(setupInfo.mcp.args)}`,
          `   env: ${JSON.stringify(setupInfo.mcp.env)}`,
        ].join("\n")
      : "   (Tower MCP config not ready yet — retry in a moment)";
    const skillDir = setupInfo?.skillDir ?? "<Tower 安装目录>/skills/tower";
    return [
      `帮我把 Tower 接入 ${gl}，让它能用 Tower 的 MCP 工具与技能（作为无人值守网关）。前提：${gl} 与 Tower 在同一台机器上，MCP 走 stdio。`,
      "",
      `1) 注册 Tower MCP server（stdio）—— 在 ${gl} 的 MCP 配置里加一条：`,
      mcpBlock,
      "",
      `2) 加载 Tower 技能 —— 软链到 ${gl} 的技能目录（软链而非复制，随 Tower 更新自动生效）：`,
      `   ln -s "${skillDir}" <你的技能目录>/tower`,
      "",
      `3) 验证 —— 连上后应能调用 create_task / list_tasks / ask_human / notify_human 等 Tower 工具，技能列表里出现「tower」。`,
    ].join("\n");
  };

  const copyGatewayPrompt = async (gw: string) => {
    try {
      await navigator.clipboard.writeText(buildGatewayPrompt(gw));
      toast.success(t("settings.harness.gatewaySetupCopied"));
    } catch {
      toast.error(t("settings.harness.copyFailed"));
    }
  };

  const runTest = async (tgt: NotifyTarget) => {
    if (!testDest.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testHarnessTarget({ gateway: tgt.gateway, downstream: tgt.downstream, dest: testDest.trim() });
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, output: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const dsLabel = (ds: string): string =>
    KNOWN_DS.includes(ds) ? tk(`settings.harness.ds.${ds}`) : ds;

  const summaryOf = (tgt: NotifyTarget): string => {
    const g = tk(`settings.harness.gateway.${tgt.gateway}`);
    return tgt.downstream ? `${g} · ${dsLabel(tgt.downstream)}` : g;
  };

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("settings.harness.title")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.harness.desc")}</p>
      </div>

      {/* Notice + setup help (doc links + one-click copy prompt) */}
      <div className="space-y-2 rounded-lg bg-muted/30 px-3 py-2">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t("settings.harness.notice")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-xs">
          <span className="text-muted-foreground">{t("settings.harness.docsLabel")}：</span>
          {GATEWAYS.map((g) =>
            DOCS[g] ? (
              <a
                key={g}
                href={DOCS[g]}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                {tk(`settings.harness.gateway.${g}`)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={copyPrompt}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <Copy className="h-3 w-3" />
                  {t("settings.harness.copyPrompt")}
                </button>
              }
            />
            <TooltipContent className="max-w-xs whitespace-pre-line text-left">
              {t("settings.harness.copyPromptTip")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

      <div className="space-y-2">
        {targets.map((tgt) => {
          const custom = customIds.has(tgt.id);
          return editingId === tgt.id ? (
            <div key={tgt.id} className="rounded-lg border bg-muted/30 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("settings.harness.gatewayLabel")}>
                  <Select
                    value={tgt.gateway}
                    onValueChange={(v) => {
                      const g = v ?? "feishu";
                      const opts = dsOptions(g);
                      patch(tgt.id, {
                        gateway: g,
                        downstream: opts.includes(tgt.downstream) ? tgt.downstream : (opts[0] ?? ""),
                      });
                      setCustom(tgt.id, false);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <span className="truncate">{tk(`settings.harness.gateway.${tgt.gateway}`)}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {GATEWAYS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {tk(`settings.harness.gateway.${g}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("settings.harness.downstreamLabel")}>
                  <Select
                    value={custom ? CUSTOM : tgt.downstream}
                    onValueChange={(v) => {
                      if (v === CUSTOM) {
                        setCustom(tgt.id, true);
                        patch(tgt.id, { downstream: "" });
                      } else {
                        setCustom(tgt.id, false);
                        patch(tgt.id, { downstream: v ?? "" });
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <span className="truncate">
                        {custom
                          ? t("settings.harness.ds.custom")
                          : tgt.downstream
                            ? dsLabel(tgt.downstream)
                            : t("settings.harness.downstreamPlaceholder")}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {dsOptions(tgt.gateway).map((d) => (
                        <SelectItem key={d} value={d}>
                          {tk(`settings.harness.ds.${d}`)}
                        </SelectItem>
                      ))}
                      {allowsCustom(tgt.gateway) && (
                        <SelectItem value={CUSTOM}>{t("settings.harness.ds.custom")}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {custom && (
                <Field label={t("settings.harness.customLabel")}>
                  <Input
                    value={tgt.downstream}
                    onChange={(e) => patch(tgt.id, { downstream: e.target.value })}
                    placeholder={t("settings.harness.customPlaceholder")}
                  />
                </Field>
              )}

              {/* Test: fill a destination and actually send one */}
              <Field label={t("settings.harness.test")}>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={testDest}
                      onChange={(e) => setTestDest(e.target.value)}
                      placeholder={t(
                        MCP_GATEWAYS.has(tgt.gateway)
                          ? "settings.harness.testDestPlaceholderId"
                          : "settings.harness.testDestPlaceholder",
                      )}
                      className="flex-1"
                    />
                    <Button variant="outline" onClick={() => runTest(tgt)} disabled={testing || !testDest.trim()}>
                      {testing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span>{testing ? t("settings.harness.testing") : t("settings.harness.testSend")}</span>
                    </Button>
                  </div>
                  {testResult && (
                    <div
                      className={`flex items-start gap-1.5 rounded bg-muted/40 px-2 py-1 text-xs ${
                        testResult.ok ? "text-emerald-500" : "text-rose-400"
                      }`}
                    >
                      {testResult.ok ? (
                        <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="whitespace-pre-wrap break-words">
                        {testResult.ok
                          ? t("settings.harness.testOk")
                          : `${t("settings.harness.testFail")}：${testResult.output}`}
                      </span>
                    </div>
                  )}
                </div>
              </Field>

              {/* openclaw/hermes gateway: the side running the agent must wire in Tower MCP + skill → offer a copyable integration prompt */}
              {MCP_GATEWAYS.has(tgt.gateway) && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        className="text-muted-foreground"
                        onClick={() => copyGatewayPrompt(tgt.gateway)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span className="text-xs">{t("settings.harness.gatewaySetup")}</span>
                      </Button>
                    }
                  />
                  <TooltipContent className="max-w-xs whitespace-pre-line text-left">
                    {t("settings.harness.gatewaySetupTip")}
                  </TooltipContent>
                </Tooltip>
              )}

              <div className="flex items-center gap-2 pt-1">
                <Button variant="ghost" className="text-muted-foreground" onClick={() => removeTarget(tgt.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t("settings.harness.remove")}</span>
                </Button>
                <Button onClick={() => { setEditingId(null); setTestResult(null); }}>
                  <Check className="h-3.5 w-3.5" />
                  <span>{t("settings.harness.done")}</span>
                </Button>
              </div>
            </div>
          ) : (
            <div
              key={tgt.id}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
                tgt.active ? "border-primary/40 bg-primary/5" : "bg-muted/20"
              }`}
            >
              <button
                type="button"
                onClick={() => setActive(tgt.id)}
                title={t("settings.harness.setActive")}
                className={tgt.active ? "text-primary" : "text-muted-foreground hover:text-foreground"}
              >
                {tgt.active ? <CircleDot className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
              </button>
              <span className="truncate text-sm text-foreground">{summaryOf(tgt)}</span>
              {tgt.active && (
                <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary ring-1 ring-primary/25">
                  {t("settings.harness.active")}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  onClick={() => { setEditingId(tgt.id); setTestResult(null); setTestDest(""); }}
                  title={t("settings.harness.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  onClick={() => removeTarget(tgt.id)}
                  title={t("settings.harness.remove")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={addTarget} className="text-muted-foreground">
          <Plus className="h-3.5 w-3.5" />
          <span>{t("settings.harness.addTarget")}</span>
        </Button>
        <Button onClick={save} disabled={saving} className="rounded-lg">
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
