"use client";

import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import { Loader2, Inbox, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import {
  getHarnessMessages,
  dismissHarnessMessage,
  type HarnessMessageView,
  type HarnessView,
} from "@/actions/harness-actions";
import {
  HarnessDetailDialog,
  badgeOf,
  relTime,
  absTime,
  STATUS_COLORS,
  type BadgeKind,
} from "@/components/harness/harness-detail-dialog";

const VIEWS: HarnessView[] = ["pending", "answered", "all"];

export function HarnessClient({ initial }: { initial: HarnessMessageView[] }) {
  const { t } = useI18n();
  const [view, setView] = useState<HarnessView>("pending");
  const [messages, setMessages] = useState<HarnessMessageView[]>(initial);
  const [loading, setLoading] = useState(false);
  // 详情弹窗：当前消息 + 是否自动聚焦回复框（「处理」入口聚焦，「查看详情」不聚焦）
  const [detail, setDetail] = useState<{ m: HarnessMessageView; focus: boolean } | null>(null);
  const [pending, startTransition] = useTransition();
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const refresh = useCallback(async (v: HarnessView) => {
    try {
      const rows = await getHarnessMessages(v);
      if (viewRef.current === v) setMessages(rows);
    } catch {
      // best-effort — 轮询失败静默重试
    }
  }, []);

  const selectView = (v: HarnessView) => {
    viewRef.current = v;
    setView(v);
    setLoading(true);
    refresh(v).finally(() => {
      if (viewRef.current === v) setLoading(false);
    });
  };

  // 4s 轮询（退化方案，spec ④ 允许）
  useEffect(() => {
    const timer = setInterval(() => refresh(viewRef.current), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const badgeLabel = (b: BadgeKind): string => t(`harness.badge.${b}`);

  const openDetail = (m: HarnessMessageView, focus: boolean) => setDetail({ m, focus });

  // 「处理」：OPEN ask → 打开详情并聚焦回复框；info → 直接 dismiss
  const handle = (m: HarnessMessageView) => {
    if (m.kind === "ask" && m.state === "OPEN") {
      openDetail(m, true);
      return;
    }
    startTransition(async () => {
      await dismissHarnessMessage(m.id);
      refresh(viewRef.current);
    });
  };

  // 「处理」是否可用：OPEN ask 或 info（notify/done/failed）。已 answered ask 无需处理
  const canHandle = (m: HarnessMessageView) =>
    (m.kind === "ask" && m.state === "OPEN") || m.kind !== "ask";

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background">
        {/* 页头 */}
        <div className="header-lg flex items-center gap-3 px-6 py-3">
          <BellRing className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <h1 className="text-sm font-semibold text-foreground">{t("harness.pageTitle")}</h1>
            <p className="text-[11px] text-muted-foreground">{t("harness.pageSubtitle")}</p>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* 过滤 chips */}
        <div className="shrink-0 border-b border-border/70 px-6 py-3">
          <div className="flex items-center gap-2">
            {VIEWS.map((v) => (
              <Button
                key={v}
                variant={view === v ? "default" : "outline"}
                onClick={() => selectView(v)}
                className={view === v ? "" : "text-muted-foreground"}
              >
                {t(`harness.chip.${v}`)}
              </Button>
            ))}
          </div>
        </div>

        {/* 表格 */}
        <div className="min-h-0 flex-1 px-6 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <Inbox className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-sm">{t("harness.empty")}</p>
            </div>
          ) : (
            <div className={`h-full overflow-auto rounded-xl border bg-card ${pending ? "opacity-50" : ""}`}>
              <table className="w-full min-w-[960px] text-sm">
                <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]">
                  <tr className="text-left text-[11px] uppercase text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">{t("harness.col.workspace")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("harness.col.project")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("harness.col.task")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("harness.col.content")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("harness.col.sentAt")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("harness.col.reply")}</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">{t("harness.col.repliedAt")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("harness.col.status")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("harness.col.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => {
                    const badge = badgeOf(m);
                    return (
                      <tr key={m.id} className="border-b last:border-0 align-top">
                        <td className="px-3 py-2 whitespace-nowrap text-secondary-foreground">
                          {m.workspaceName || "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-secondary-foreground">
                          {m.projectName || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <ClampCell text={m.taskTitle} onOpen={() => openDetail(m, false)} />
                        </td>
                        <td className="px-3 py-2">
                          <ClampCell text={m.content} onOpen={() => openDetail(m, false)} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          <TimeCell iso={m.createdAt} />
                        </td>
                        <td className="px-3 py-2">
                          <ClampCell text={m.replyText ?? ""} onOpen={() => openDetail(m, false)} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                          {m.repliedAt ? <TimeCell iso={m.repliedAt} /> : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${STATUS_COLORS[badge]}`}
                          >
                            {badgeLabel(badge)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              onClick={() => openDetail(m, false)}
                              className="text-muted-foreground"
                            >
                              {t("harness.action.viewDetail")}
                            </Button>
                            {canHandle(m) && (
                              <Button onClick={() => handle(m)} disabled={pending}>
                                {t("harness.action.handle")}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <HarnessDetailDialog
        message={detail?.m ?? null}
        autoFocusReply={detail?.focus ?? false}
        badgeLabel={badgeLabel}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onChanged={() => refresh(viewRef.current)}
      />
    </TooltipProvider>
  );
}

/** 时间单元格：相对时间 + hover tooltip 绝对时间。 */
function TimeCell({ iso }: { iso: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="cursor-default">{relTime(iso)}</span>} />
      <TooltipContent>{absTime(iso)}</TooltipContent>
    </Tooltip>
  );
}

/** 长内容单元格：最多三行截断，hover tooltip 展示全文 + 查看详情提示，点击打开详情。 */
function ClampCell({ text, onOpen }: { text: string; onOpen: () => void }) {
  const { t } = useI18n();
  if (!text) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onOpen}
            className="line-clamp-3 max-w-[22rem] cursor-pointer whitespace-pre-wrap break-words text-left text-secondary-foreground hover:text-foreground"
          >
            {text}
          </button>
        }
      />
      <TooltipContent className="max-w-md whitespace-pre-wrap text-left">
        <div className="line-clamp-[12]">{text}</div>
        <div className="mt-1.5 text-[10px] opacity-70">{t("harness.tooltip.clickDetail")}</div>
      </TooltipContent>
    </Tooltip>
  );
}
