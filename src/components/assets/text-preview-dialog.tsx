"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

interface TextPreviewDialogProps {
  url: string | null;
  filename: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MAX_PREVIEW_SIZE = 1024 * 1024; // 1MB

export function TextPreviewDialog({
  url,
  filename,
  open,
  onOpenChange,
}: TextPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(960px,92vw)] max-w-none sm:max-w-none h-[85vh] max-h-[85vh] flex flex-col p-0 gap-0"
      >
        <h3 className="text-sm font-medium truncate px-5 py-3 border-b border-border/50">
          {filename}
        </h3>
        <div className="flex-1 overflow-auto px-5 py-4">
          {open && url ? <TextPreviewContent key={url} url={url} filename={filename} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TextPreviewContent({ url, filename }: { url: string; filename: string }) {
  const { t } = useI18n();
  const [result, setResult] = useState<
    { status: "ready"; content: string } | { status: "error"; message: string } | null
  >(null);

  useEffect(() => {
    let cancelled = false;

    fetch(url)
      .then((res) => {
        const contentLength = res.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_PREVIEW_SIZE) {
          throw new Error("FILE_TOO_LARGE");
        }
        return res.text();
      })
      .then((text) => {
        if (text.length > MAX_PREVIEW_SIZE) {
          throw new Error("FILE_TOO_LARGE");
        }
        if (!cancelled) {
          setResult({ status: "ready", content: text });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message =
            err instanceof Error && err.message === "FILE_TOO_LARGE"
              ? t("assets.fileTooLarge")
              : t("assets.previewError");
          setResult({ status: "error", message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url, t]);

  const ext = filename.split(".").pop()?.toLowerCase();

  const renderContent = () => {
    if (!result) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("assets.loadingPreview")}</span>
        </div>
      );
    }

    if (result.status === "error") {
      return <p className="text-sm text-destructive">{result.message}</p>;
    }

    const { content } = result;

    if (ext === "md") {
      return (
        <div className="text-sm leading-relaxed">
          <Streamdown>{content}</Streamdown>
        </div>
      );
    }

    if (ext === "json") {
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(content), null, 2);
      } catch {
        formatted = content;
      }
      return (
        <pre className="font-mono text-xs whitespace-pre-wrap text-foreground">
          {formatted}
        </pre>
      );
    }

    // Default: plain text
    return (
      <pre className="font-mono text-sm whitespace-pre-wrap text-foreground">
        {content}
      </pre>
    );
  };

  return renderContent();
}
