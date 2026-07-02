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
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { getConfigValue, setConfigValue } from "@/actions/config-actions";
import { testHarnessTarget } from "@/actions/harness-actions";

/**
 * 无人值守发送渠道注册表。Tower 只**存**这张表、不发消息。每条是一条「网关 → 下游」路由：
 * gateway（飞书 MCP / OpenClaw / Hermes）+ downstream（终端渠道）。目的地(群/人)在发送时说明。
 */
export interface NotifyTarget {
  id: string;
  gateway: string;
  downstream: string;
  active: boolean; // 单选：仅生效的这条被 agent 用于外推
}

const GATEWAYS = ["feishu", "openclaw", "hermes"];
// 各网关支持的下游渠道（据 openclaw / hermes 官网整理，非穷举，其余走「自定义」）。
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

// 各平台开放后台/文档。
const DOCS: Record<string, string> = {
  feishu: "https://open.feishu.cn/",
  openclaw: "https://docs.openclaw.ai/",
  hermes: "https://hermes-agent.nousresearch.com/docs/",
};

// 丢给 AI 的一键配置提示词。
const SETUP_PROMPT = [
  "帮我把 Tower 无人值守的通知渠道配置好，步骤：",
  "1. 用 playwright 打开对应平台的开放后台，注册/创建一个自建应用（机器人）。文档：飞书开放平台 https://open.feishu.cn/ ；OpenClaw https://docs.openclaw.ai/ ；Hermes https://hermes-agent.nousresearch.com/docs/ 。",
  "2. 拿到 appId / appSecret（或 webhook 地址 / token），开通「发送消息」权限。",
  "3. 建议**新建一个唯一名称的专属群组**（如「Tower 无人值守通知」），把机器人加进去 —— 避免同名群/人导致发错。记下群 id（或我的用户 id）。",
  "4. 把凭据配置到对应平台的 MCP（如飞书 MCP 的 config），确保能调用它发送消息。",
  "5. 在 Tower「设置 → 通知 → 无人值守发送渠道」加一条对应网关的渠道，点「测试」验证能收到消息。",
].join("\n");

export function HarnessTargetsSection() {
  const { t } = useI18n();
  const tk = (k: string) => t(k as Parameters<typeof t>[0]);
  const [targets, setTargets] = useState<NotifyTarget[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [customIds, setCustomIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, startSave] = useTransition();

  // 测试态（一次一条）
  const [testDest, setTestDest] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; output: string } | null>(null);

  useEffect(() => {
    getConfigValue<NotifyTarget[]>("harness.targets", [])
      .then((v) => {
        const rows: NotifyTarget[] = (Array.isArray(v) ? v : []).map((r) => ({
          id: r.id ?? crypto.randomUUID(),
          gateway: GATEWAYS.includes(r.gateway) ? r.gateway : "feishu",
          downstream: r.downstream ?? "feishu",
          active: !!r.active,
        }));
        // 保证有渠道时恰好一个生效（无则默认第一条）。
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
    // 第一条自动生效。
    setTargets((ts) => [...ts, { id, gateway: "feishu", downstream: "feishu", active: ts.length === 0 }]);
    setEditingId(id);
    setTestResult(null);
  };

  // 单选生效：设一条为生效，其余取消。
  const setActive = (id: string) =>
    setTargets((ts) => ts.map((x) => ({ ...x, active: x.id === id })));

  const removeTarget = (id: string) => {
    setTargets((ts) => {
      const wasActive = ts.find((x) => x.id === id)?.active;
      const rest = ts.filter((x) => x.id !== id);
      // 删掉生效的那条 → 让第一条剩余的生效。
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
      toast.error("复制失败");
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

      {/* 提示 + 配置帮助（文档链接 + 一键复制提示词） */}
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
          <button
            type="button"
            onClick={copyPrompt}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <Copy className="h-3 w-3" />
            {t("settings.harness.copyPrompt")}
          </button>
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

              {/* 测试：填目的地真发一条 */}
              <Field label={t("settings.harness.test")}>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={testDest}
                      onChange={(e) => setTestDest(e.target.value)}
                      placeholder={t("settings.harness.testDestPlaceholder")}
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

              <div className="flex items-center gap-2 pt-1">
                <Button onClick={() => { setEditingId(null); setTestResult(null); }}>
                  <Check className="h-3.5 w-3.5" />
                  <span>{t("settings.harness.done")}</span>
                </Button>
                <Button variant="ghost" className="text-muted-foreground" onClick={() => removeTarget(tgt.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t("settings.harness.remove")}</span>
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
