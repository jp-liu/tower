"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !url) {
      setContent(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);

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
          setContent(text);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof Error && err.message === "FILE_TOO_LARGE") {
            setError(t("assets.fileTooLarge"));
          } else {
            setError(t("assets.previewError"));
          }
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, url, t]);

  const ext = filename.split(".").pop()?.toLowerCase();

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-2">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t("assets.loadingPreview")}</span>
        </div>
      );
    }

    if (error) {
      return <p className="text-sm text-destructive">{error}</p>;
    }

    if (content === null) {
      return null;
    }

    if (ext === "md") {
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <h3 className="text-sm font-medium truncate px-4 pt-4">{filename}</h3>
        <div className="flex-1 overflow-auto px-4 pb-4 pt-2">
          {renderContent()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
