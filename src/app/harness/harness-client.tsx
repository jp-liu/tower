"use client";

import { useState, useEffect, useCallback, useRef, useTransition } from "react";
import { Loader2, Inbox, Send, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import {
  getHarnessMessages,
  replyHarnessAsk,
  ignoreHarnessAsk,
  dismissHarnessMessage,
  resendHarnessMessage_action,
  type HarnessMessageView,
  type HarnessView,
} from "@/actions/harness-actions";

const VIEWS: HarnessView[] = ["pending", "failed", "answered", "all"];

const KIND_KEY = {
  ask: "harness.kind.ask",
  notify: "harness.kind.notify",
  done: "harness.kind.done",
  failed: "harness.kind.failed",
} as const;

// 状态徽标配色（spec ④）：待回复 amber、失败 red、已回复 emerald、通知/完成 muted。
const STATUS_COLORS = {
  pending: "bg-amber-500/15 text-amber-500 ring-amber-500/25",
  failed: "bg-rose-500/15 text-rose-400 ring-rose-500/25",
  answered: "bg-emerald-500/15 text-emerald-500 ring-emerald-500/25",
  muted: "bg-muted text-muted-foreground ring-border",
} as const;

type BadgeKind = keyof typeof STATUS_COLORS;

function badgeOf(m: HarnessMessageView): BadgeKind {
  if (m.kind === "ask") {
    if (m.state === "ANSWERED") return "answered";
    if (m.state === "OPEN") return "pending";
  }
  if (m.notifyStatus === "FAILED") return "failed";
  return "muted";
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function HarnessClient({ initial }: { initial: HarnessMessageView[] }) {
  const { t } = useI18n();
  const [view, setView] = useState<HarnessView>("pending");
  const [messages, setMessages] = useState<HarnessMessageView[]>(initial);
  const [loading, setLoading] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;

  const refresh = useCallback(async (v: HarnessView) => {
    try {
      const rows = await getHarnessMessages(v);
      if (viewRef.current === v) setMessages(rows);
    } catch {
      // best-effort — 轮询失败静默重试
    }
  }, []);

  // 切换视图立即拉取
  useEffect(() => {
    setLoading(true);
    refresh(view).finally(() => setLoading(false));
  }, [view, refresh]);

  // 4s 轮询（退化方案，spec ④ 允许）
  useEffect(() => {
    const timer = setInterval(() => refresh(viewRef.current), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  const badgeLabel = (b: BadgeKind): string => t(`harness.badge.${b}`);

  return (
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
      <div className="flex items-center gap-2 px-6 py-3">
        {VIEWS.map((v) => (
          <Button
            key={v}
            variant={view === v ? "default" : "outline"}
            onClick={() => setView(v)}
            className={view === v ? "" : "text-muted-foreground"}
          >
            {t(`harness.chip.${v}`)}
          </Button>
        ))}
      </div>

      {/* 网格 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <Inbox className="mb-3 h-10 w-10 opacity-40" />
            <p className="text-sm">{t("harness.empty")}</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {messages.map((m) => (
              <HarnessCard
                key={m.id}
                m={m}
                badge={badgeOf(m)}
                badgeLabel={badgeLabel}
                onChanged={() => refresh(viewRef.current)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HarnessCard({
  m,
  badge,
  badgeLabel,
  onChanged,
}: {
  m: HarnessMessageView;
  badge: BadgeKind;
  badgeLabel: (b: BadgeKind) => string;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();

  const isOpenAsk = m.kind === "ask" && m.state === "OPEN";
  const isInfo = m.kind !== "ask";
  const isFailed = m.notifyStatus === "FAILED";

  const delivery =
    m.notifyStatus === "SENT"
      ? t("harness.meta.delivered")
      : m.notifyStatus === "FAILED"
        ? t("harness.meta.notDelivered")
        : t("harness.meta.notSent");

  const doReply = () => {
    if (!reply.trim()) return;
    startTransition(async () => {
      const r = await replyHarnessAsk(m.taskId, reply.trim());
      if (r.ok) {
        toast.success(t("harness.toast.replySent"));
        setReply("");
        onChanged();
      } else {
        toast.error(r.error ?? t("harness.toast.replyFailed"));
      }
    });
  };

  const doIgnore = () =>
    startTransition(async () => {
      await ignoreHarnessAsk(m.id);
      onChanged();
    });

  const doDismiss = () =>
    startTransition(async () => {
      await dismissHarnessMessage(m.id);
      onChanged();
    });

  const doResend = () =>
    startTransition(async () => {
      const r = await resendHarnessMessage_action(m.id);
      if (r.ok) toast.success(t("harness.toast.resent"));
      else toast.error(t("harness.toast.resendFailed"));
      onChanged();
    });

  return (
    <div className={`relative flex flex-col rounded-xl border bg-card p-4 ${pending ? "opacity-50" : ""}`}>
      {/* 头：任务名 + 状态徽标 */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground" title={m.taskTitle}>
          {m.taskTitle || t("harness.unknownTask")}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${STATUS_COLORS[badge]}`}
        >
          {badgeLabel(badge)}
        </span>
      </div>

      {/* 元行：kind · 时间 · 渠道送达标 */}
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{t(KIND_KEY[m.kind as keyof typeof KIND_KEY] ?? "harness.kind.notify")}</span>
        <span>·</span>
        <span>{relTime(m.createdAt)}</span>
        {m.channel && (
          <>
            <span>·</span>
            <span>
              {m.channel} {delivery}
            </span>
          </>
        )}
      </div>

      {/* 正文：发送内容 */}
      <p className="whitespace-pre-wrap break-words text-sm text-secondary-foreground">{m.content}</p>

      {/* 已回复追加 */}
      {m.replyText && (
        <div className="mt-2 rounded-lg bg-muted/30 px-3 py-2 text-xs text-foreground">
          <span className="text-muted-foreground">{t("harness.youReplied")}：</span>
          {m.replyText}
          {m.repliedAt && <span className="ml-1 text-muted-foreground">({relTime(m.repliedAt)})</span>}
        </div>
      )}

      {/* 动作 */}
      {isOpenAsk && (
        <div className="mt-3 space-y-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t("harness.replyPlaceholder")}
            rows={2}
            className="w-full resize-none rounded-lg border bg-muted/30 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/30"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doReply();
            }}
          />
          <div className="flex items-center gap-2">
            <Button onClick={doReply} disabled={!reply.trim() || pending}>
              <Send className="h-3.5 w-3.5" />
              <span>{t("harness.action.send")}</span>
            </Button>
            <Button variant="outline" onClick={doIgnore} disabled={pending} className="text-muted-foreground">
              {t("harness.action.ignore")}
            </Button>
            {isFailed && (
              <Button variant="outline" onClick={doResend} disabled={pending} className="text-muted-foreground">
                {t("harness.action.resend")}
              </Button>
            )}
          </div>
        </div>
      )}

      {isInfo && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" onClick={doDismiss} disabled={pending} className="text-muted-foreground">
            {t("harness.action.dismiss")}
          </Button>
          {isFailed && (
            <Button variant="outline" onClick={doResend} disabled={pending} className="text-muted-foreground">
              {t("harness.action.resend")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
