"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import {
  replyHarnessAsk,
  ignoreHarnessAsk,
  dismissHarnessMessage,
  type HarnessMessageView,
} from "@/actions/harness-actions";

export const KIND_KEY = {
  ask: "harness.kind.ask",
  notify: "harness.kind.notify",
  done: "harness.kind.done",
  failed: "harness.kind.failed",
} as const;

// 状态徽标配色：待回复 amber、已回复 emerald、通知/完成 muted。
export const STATUS_COLORS = {
  pending: "bg-amber-500/15 text-amber-500 ring-amber-500/25",
  answered: "bg-emerald-500/15 text-emerald-500 ring-emerald-500/25",
  muted: "bg-muted text-muted-foreground ring-border",
} as const;

export type BadgeKind = keyof typeof STATUS_COLORS;

export function badgeOf(m: HarnessMessageView): BadgeKind {
  if (m.kind === "ask") {
    if (m.state === "ANSWERED") return "answered";
    if (m.state === "OPEN") return "pending";
  }
  return "muted";
}

export function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** 绝对时间（tooltip / 详情弹窗用），本地化短格式。 */
export function absTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * 单条通知详情弹窗：发送内容 + 回复内容上下铺开（不用 tab）。
 * OPEN ask 带回复框，notify/done/failed 带 Dismiss，已回复只读。
 */
export function HarnessDetailDialog({
  message,
  autoFocusReply,
  badgeLabel,
  onOpenChange,
  onChanged,
}: {
  message: HarnessMessageView | null;
  autoFocusReply: boolean;
  badgeLabel: (b: BadgeKind) => string;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
  const replyRef = useRef<HTMLTextAreaElement>(null);

  // 每次打开新消息清空草稿；OPEN ask 且要求聚焦时聚焦输入框
  useEffect(() => {
    if (!message) return;
    setReply("");
    if (autoFocusReply && message.kind === "ask" && message.state === "OPEN") {
      // 等 Dialog 挂载后聚焦
      const id = setTimeout(() => replyRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [message, autoFocusReply]);

  if (!message) return null;
  const m = message;
  const isOpenAsk = m.kind === "ask" && m.state === "OPEN";
  const isInfo = m.kind !== "ask";
  const badge = badgeOf(m);

  const doReply = () => {
    if (!reply.trim()) return;
    startTransition(async () => {
      const r = await replyHarnessAsk(m.taskId, reply.trim());
      if (r.ok) {
        toast.success(t("harness.toast.replySent"));
        setReply("");
        onChanged();
        onOpenChange(false);
      } else {
        toast.error(r.error ?? t("harness.toast.replyFailed"));
      }
    });
  };

  const doIgnore = () =>
    startTransition(async () => {
      await ignoreHarnessAsk(m.id);
      onChanged();
      onOpenChange(false);
    });

  const doDismiss = () =>
    startTransition(async () => {
      await dismissHarnessMessage(m.id);
      onChanged();
      onOpenChange(false);
    });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-left">
                {m.taskTitle || t("harness.unknownTask")}
              </DialogTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[m.workspaceName, m.projectName].filter(Boolean).join(" / ") || "—"}
                <span className="mx-1.5">·</span>
                {t(KIND_KEY[m.kind as keyof typeof KIND_KEY] ?? "harness.kind.notify")}
                <span className="mx-1.5">·</span>
                {absTime(m.createdAt)}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${STATUS_COLORS[badge]}`}
            >
              {badgeLabel(badge)}
            </span>
          </div>
        </DialogHeader>

        <div className={`space-y-4 ${pending ? "opacity-50" : ""}`}>
          {/* 发送内容 */}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {t("harness.detail.sent")}
            </div>
            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 px-3 py-2 text-sm text-secondary-foreground">
              {m.content}
            </p>
          </div>

          {/* 回复内容 */}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {t("harness.detail.reply")}
            </div>
            {m.replyText ? (
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 px-3 py-2 text-sm text-foreground">
                {m.replyText}
                {m.repliedAt && (
                  <span className="ml-1 text-muted-foreground">（{absTime(m.repliedAt)}）</span>
                )}
              </p>
            ) : !isOpenAsk ? (
              <p className="text-sm text-muted-foreground">{t("harness.detail.noReply")}</p>
            ) : null}
          </div>

          {/* OPEN ask：回复框 */}
          {isOpenAsk && (
            <div className="space-y-2">
              <textarea
                ref={replyRef}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={t("harness.replyPlaceholder")}
                rows={3}
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
                <Button
                  variant="outline"
                  onClick={doIgnore}
                  disabled={pending}
                  className="text-muted-foreground"
                >
                  {t("harness.action.ignore")}
                </Button>
              </div>
            </div>
          )}

          {/* notify/done/failed：Dismiss */}
          {isInfo && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={doDismiss}
                disabled={pending}
                className="text-muted-foreground"
              >
                {t("harness.action.dismiss")}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
