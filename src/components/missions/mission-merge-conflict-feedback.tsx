"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export interface MergeConflictFeedbackState {
  status: "sending" | "sent" | "failed";
  message: string;
  error?: string;
}

export function MissionMergeConflictFeedback({
  feedback,
}: {
  feedback: MergeConflictFeedbackState;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  if (feedback.status === "sending") {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        {t("merge.conflictSendingToAgent")}
      </p>
    );
  }

  if (feedback.status === "sent") {
    return (
      <p className="text-xs text-emerald-500" role="status">
        {t("merge.conflictSentToAgent")}
      </p>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(feedback.message);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-red-500/20 bg-red-500/10 p-2.5">
      <p className="text-xs text-red-400" role="alert">
        {t("merge.conflictSendFailed", { error: feedback.error ?? t("merge.networkError") })}
      </p>
      <div className="relative">
        <pre
          aria-label={t("merge.conflictCopyableMessage")}
          className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/70 p-2 pr-10 text-xs text-foreground"
        >
          {feedback.message}
        </pre>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 h-7 w-7"
          aria-label={copied ? t("common.copied") : t("common.copy")}
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
