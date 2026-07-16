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
import { testHarnessTarget } from "@/actions/harness-actions";

/**
 * 无人值守发送渠道注册表。每条是一条「网关 → 下游」路由：
 * gateway（OpenClaw / Hermes）+ downstream（终端渠道）。work 目的地(群/人)在发送时说明。
 */
export type NotifyScope = "work" | "unattended";
export interface NotifyTarget {
  id: string;
  gateway: string;
  downstream: string;
  dest?: string; // exact chat/user id; unattended Hermes may leave blank to use its home channel
  active: boolean; // 单选（按 scope 各自单选）：该类别里生效的这条被 agent 用于外推
  scope: NotifyScope; // work=在场发群讨论 / unattended=下班找本人
}
const SCOPES: NotifyScope[] = ["work", "unattended"];

const GATEWAYS = ["hermes", "openclaw"];
// 各网关支持的下游渠道（据 openclaw / hermes 官网整理，非穷举，其余走「自定义」）。
const DS_BY_GATEWAY: Record<string, string[]> = {
  openclaw: ["feishu", "telegram", "signal", "whatsapp", "discord", "slack", "imessage"],
  hermes: [
    "telegram", "discord", "slack", "whatsapp", "signal",
    "feishu", "wechat", "wecom", "dingtalk", "qq", "matrix", "email",
  ],
};
const KNOWN_DS = [...new Set(Object.values(DS_BY_GATEWAY).flat())];
const CUSTOM = "__custom__";
const allowsCustom = () => true;
const dsOptions = (gw: string) => DS_BY_GATEWAY[gw] ?? [];
const isWechatDownstream = (downstream?: string | null) => {
  const ds = downstream?.trim().toLowerCase();
  return ds === "wechat" || ds === "weixin";
};
const isHermesWechatUnattended = (target: NotifyTarget) =>
  target.gateway === "hermes" && target.scope === "unattended" && isWechatDownstream(target.downstream);

// Module-level so its identity is stable across renders. Defined inside the
// component, every keystroke minted a fresh component type and React remounted
// the wrapped <Input>, dropping focus after one character.
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1">
    <label className="text-xs text-muted-foreground">{label}</label>
    {children}
  </div>
);

// 各平台开放后台/文档。
const DOCS: Record<string, string> = {
  openclaw: "https://docs.openclaw.ai/",
  hermes: "https://hermes-agent.nousresearch.com/docs/",
};

// 丢给 AI 的一键配置提示词（默认走飞书；OpenClaw / Hermes 见末尾）。
// 与「飞书助理机器人」同事上手文档里的创建提示词保持一致 —— 同一个应用可同时用于无人值守通知与飞书助理。
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
  "7. 把 appId / appSecret / domain 配到 Hermes 或 OpenClaw 的飞书下游，并在 Tower「设置 → 通知 → 消息发送渠道」加一条 Hermes/OpenClaw → 飞书渠道，点「测试」验证能收到消息。",
  "",
  "避坑：① 域名别搞反 —— 公司飞书和公网飞书是两套、凭据不通用；② 只「建了应用」不等于能用，必须开机器人能力 + 发布版本 + 拉进群三样齐；③ 别用 curl 直接抓控制台页面（有 WAF 会 403），用浏览器（Playwright）操作。",
  "",
  "（换 OpenClaw / Hermes 等其它网关：参考各自文档 https://docs.openclaw.ai/ · https://hermes-agent.nousresearch.com/docs/ ，拿到 token / webhook 后同样在 Tower 加渠道并测试。）",
].join("\n");

export function HarnessTargetsSection() {
  const { t } = useI18n();
  const tk = (k: string) => t(k as Parameters<typeof t>[0]);
  const [targets, setTargets] = useState<NotifyTarget[]>([]);
  // 多卡片可同时展开编辑（work / unattended 互不干扰）。
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [editSnapshots, setEditSnapshots] = useState<Record<string, NotifyTarget | null>>({});
  const isEditing = (id: string) => editingIds.has(id);
  const openEdit = (id: string) => {
    const snapshot = targets.find((x) => x.id === id) ?? null;
    setEditSnapshots((s) => (id in s ? s : { ...s, [id]: snapshot }));
    setEditingIds((s) => new Set(s).add(id));
  };
  const closeEdit = (id: string) => {
    setEditingIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setEditSnapshots((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
  };
  const [customIds, setCustomIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, startSave] = useTransition();

  // 测试态按渠道 id 隔离，避免跨卡片串台。
  type TestState = { dest: string; testing: boolean; result: { ok: boolean; output: string } | null };
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const testOf = (id: string): TestState => tests[id] ?? { dest: "", testing: false, result: null };
  const setTest = (id: string, p: Partial<TestState>) =>
    setTests((t) => ({ ...t, [id]: { ...testOf(id), ...p } }));

  useEffect(() => {
    getConfigValue<NotifyTarget[]>("harness.targets", [])
      .then((v) => {
        const rows: NotifyTarget[] = (Array.isArray(v) ? v : []).map((r) => ({
          id: r.id ?? crypto.randomUUID(),
          gateway: GATEWAYS.includes(r.gateway) ? r.gateway : "hermes",
          downstream: r.downstream ?? "feishu",
          dest: r.dest ?? "",
          active: !!r.active,
          // 老数据无 scope → 当无人值守（原来这张表就是给无人值守外推配的）。
          scope: r.scope === "work" ? "work" : "unattended",
        }));
        // 每个类别各保证恰好一个生效（无则该类别第一条）。
        for (const sc of SCOPES) {
          const group = rows.filter((r) => r.scope === sc);
          if (group.length > 0 && !group.some((r) => r.active)) group[0].active = true;
        }
        setTargets(rows);
        setCustomIds(
          new Set(rows.filter((r) => r.downstream && !KNOWN_DS.includes(r.downstream)).map((r) => r.id))
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const patch = (id: string, p: Partial<NotifyTarget>) =>
    setTargets((ts) => ts.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const addTarget = (scope: NotifyScope) => {
    const id = crypto.randomUUID();
    const preferredGateway =
      targets.some((t) => t.gateway === "openclaw") || scope === "work" ? "openclaw" : "hermes";
    const downstream = dsOptions(preferredGateway)[0] ?? "feishu";
    // 该类别第一条自动生效。
    setTargets((ts) => [
      ...ts,
      { id, gateway: preferredGateway, downstream, dest: "", scope, active: !ts.some((t) => t.scope === scope) },
    ]);
    openEdit(id);
  };

  // 单选生效（限本类别）：设一条为生效，同类别其余取消，别的类别不动。
  const setActive = (id: string) =>
    setTargets((ts) => {
      const scope = ts.find((x) => x.id === id)?.scope;
      return ts.map((x) => (x.scope === scope ? { ...x, active: x.id === id } : x));
    });

  const removeTarget = (id: string) => {
    setTargets((ts) => {
      const removed = ts.find((x) => x.id === id);
      const rest = ts.filter((x) => x.id !== id);
      // 删掉某类别里生效的那条 → 让同类别第一条剩余的生效。
      if (removed?.active) {
        const group = rest.filter((x) => x.scope === removed.scope);
        if (group.length > 0 && !group.some((x) => x.active)) {
          const first = group[0];
          return rest.map((x) => (x.id === first.id ? { ...x, active: true } : x));
        }
      }
      return rest;
    });
    closeEdit(id);
  };

  const setCustom = (id: string, on: boolean) =>
    setCustomIds((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const cancelEdit = (id: string) => {
    const snapshot = editSnapshots[id];
    if (snapshot) {
      setTargets((ts) => ts.map((x) => (x.id === id ? snapshot : x)));
      setCustom(id, !!snapshot.downstream && !KNOWN_DS.includes(snapshot.downstream));
      setTest(id, { dest: snapshot.dest ?? "", result: null, testing: false });
    } else {
      setTargets((ts) => ts.filter((x) => x.id !== id));
      setCustom(id, false);
      setTest(id, { dest: "", result: null, testing: false });
    }
    closeEdit(id);
  };

  const save = () =>
    startSave(async () => {
      await setConfigValue("harness.targets", targets);
      setEditingIds(new Set());
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

  const runTest = async (tgt: NotifyTarget) => {
    const useHomeRoute = isHermesWechatUnattended(tgt);
    const dest = useHomeRoute ? "" : (testOf(tgt.id).dest || tgt.dest || "").trim();
    const canUseHermesHome = tgt.gateway === "hermes" && tgt.scope === "unattended" && !!tgt.downstream?.trim();
    if (!dest && !canUseHermesHome) return;
    setTest(tgt.id, { testing: true, result: null });
    try {
      const r = await testHarnessTarget({ gateway: tgt.gateway, downstream: tgt.downstream, dest, scope: tgt.scope });
      setTest(tgt.id, { testing: false, result: r });
    } catch (e) {
      setTest(tgt.id, { testing: false, result: { ok: false, output: e instanceof Error ? e.message : String(e) } });
    }
  };

  const dsLabel = (ds: string): string =>
    KNOWN_DS.includes(ds) ? tk(`settings.harness.ds.${ds}`) : ds;

  const summaryOf = (tgt: NotifyTarget): string => {
    const g = tk(`settings.harness.gateway.${tgt.gateway}`);
    return tgt.downstream ? `${g} · ${dsLabel(tgt.downstream)}` : g;
  };

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

      {SCOPES.map((sc) => (
        <div key={sc} className="space-y-2">
          <div className="space-y-0.5">
            <h4 className="text-xs font-semibold text-foreground">
              {sc === "work" ? t("settings.harness.scope.work") : t("settings.harness.scope.unattended")}
            </h4>
            <p className="text-[11px] text-muted-foreground">
              {sc === "work" ? t("settings.harness.scope.workDesc") : t("settings.harness.scope.unattendedDesc")}
            </p>
          </div>
          {targets.filter((r) => r.scope === sc).length === 0 && (
            <p className="rounded-lg border border-dashed bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
              {t("settings.harness.scope.empty")}
            </p>
          )}
          {targets.filter((r) => r.scope === sc).map((tgt) => {
          const custom = customIds.has(tgt.id);
          const ts = testOf(tgt.id);
          return isEditing(tgt.id) ? (
            <div key={tgt.id} className="rounded-lg border bg-muted/30 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("settings.harness.gatewayLabel")}>
                  <Select
                    value={tgt.gateway}
                    onValueChange={(v) => {
                      const g = v ?? "hermes";
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
                      {allowsCustom() && (
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

              {tgt.scope === "unattended" && !isHermesWechatUnattended(tgt) && (
                <Field label={t("settings.harness.destLabel")}>
                  <Input
                    value={tgt.dest ?? ""}
                    onChange={(e) => {
                      patch(tgt.id, { dest: e.target.value });
                      setTest(tgt.id, { dest: e.target.value });
                    }}
                    placeholder={
                      tgt.gateway === "hermes"
                        ? t("settings.harness.destPlaceholderHome")
                        : t("settings.harness.destPlaceholder")
                    }
                  />
                </Field>
              )}

              {/* 测试：填目的地真发一条 */}
              <Field label={t("settings.harness.test")}>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {!isHermesWechatUnattended(tgt) && (
                      <Input
                        value={ts.dest}
                        onChange={(e) => setTest(tgt.id, { dest: e.target.value })}
                        placeholder={t(
                          "settings.harness.testDestPlaceholder"
                        )}
                        className="flex-1"
                      />
                    )}
                    <Button
                      variant="outline"
                      onClick={() => runTest(tgt)}
                      className={isHermesWechatUnattended(tgt) ? "w-full justify-center" : undefined}
                      disabled={
                        ts.testing ||
                        !(
                          isHermesWechatUnattended(tgt) ||
                          (ts.dest || tgt.dest || "").trim() ||
                          (tgt.gateway === "hermes" && tgt.scope === "unattended" && tgt.downstream?.trim())
                        )
                      }
                    >
                      {ts.testing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span>{ts.testing ? t("settings.harness.testing") : t("settings.harness.testSend")}</span>
                    </Button>
                  </div>
                  {ts.result && (
                    <div
                      className={`flex items-start gap-1.5 rounded bg-muted/40 px-2 py-1 text-xs ${
                        ts.result.ok ? "text-emerald-500" : "text-rose-400"
                      }`}
                    >
                      {ts.result.ok ? (
                        <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="whitespace-pre-wrap break-words">
                        {ts.result.ok
                          ? t("settings.harness.testOk")
                          : `${t("settings.harness.testFail")}：${ts.result.output}`}
                      </span>
                    </div>
                  )}
                </div>
              </Field>

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeTarget(tgt.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t("settings.harness.remove")}</span>
                </Button>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => cancelEdit(tgt.id)}>
                    <span>{t("common.cancel")}</span>
                  </Button>
                  <Button onClick={() => closeEdit(tgt.id)}>
                    <Check className="h-3.5 w-3.5" />
                    <span>{t("settings.harness.done")}</span>
                  </Button>
                </div>
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
                  onClick={() => openEdit(tgt.id)}
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
          <Button
            variant="outline"
            onClick={() => addTarget(sc)}
            className="text-muted-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{sc === "work" ? t("settings.harness.addWork") : t("settings.harness.addUnattended")}</span>
          </Button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving} className="rounded-lg">
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}
