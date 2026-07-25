"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { readFileContent, type FileReadResult } from "@/actions/file-actions";

interface SimpleFileViewerProps {
  worktreePath: string;
  selectedFilePath: string | null;
  selectedLine: number | null;
}

/** Read-only plain-text fallback when Monaco extension isn't installed.
 * Used to keep search-result click usable: shows file content with line
 * numbers and scrolls/highlights the matched line. No syntax highlighting. */
export function SimpleFileViewer(props: SimpleFileViewerProps) {
  const viewerKey = `${props.worktreePath}:${props.selectedFilePath ?? "none"}`;
  return <SimpleFileViewerState key={viewerKey} {...props} />;
}

function SimpleFileViewerState({
  worktreePath,
  selectedFilePath,
  selectedLine,
}: SimpleFileViewerProps) {
  const { t } = useI18n();
  const [result, setResult] = useState<FileReadResult | null>(null);
  const [loading, setLoading] = useState(!!selectedFilePath);
  const [error, setError] = useState<string | null>(null);
  const lineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedFilePath) return;
    const prefix = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
    const relativePath = selectedFilePath.startsWith(prefix)
      ? selectedFilePath.slice(prefix.length)
      : selectedFilePath;

    let cancelled = false;
    readFileContent(worktreePath, relativePath)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [worktreePath, selectedFilePath]);

  useEffect(() => {
    if (result?.kind === "text" && selectedLine) {
      requestAnimationFrame(() => {
        lineRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
      });
    }
  }, [result, selectedLine]);

  if (!selectedFilePath) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center gap-1.5">
        <p className="text-sm text-muted-foreground">{t("editor.selectFile")}</p>
        <p className="text-xs text-muted-foreground/70">
          {t("simpleViewer.fallbackNotice")}
        </p>
      </div>
    );
  }

  const relativeForDisplay = (() => {
    const prefix = worktreePath.endsWith("/") ? worktreePath : worktreePath + "/";
    return selectedFilePath.startsWith(prefix)
      ? selectedFilePath.slice(prefix.length)
      : selectedFilePath;
  })();

  return (
    <div className="flex h-full flex-col">
      <div className="header-xs px-3 flex items-center justify-between gap-2 flex-shrink-0">
        <span className="text-xs font-mono text-foreground truncate">
          {relativeForDisplay}
        </span>
        <span className="text-[11px] text-muted-foreground flex-shrink-0">
          {t("simpleViewer.fallbackNotice")}
        </span>
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : result?.kind === "oversized" ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t("simpleViewer.oversized", {
                size: formatBytes(result.size),
                limit: formatBytes(result.limit),
              })}
            </p>
          </div>
        ) : result?.kind === "binary" ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-muted-foreground">{t("simpleViewer.binary")}</p>
          </div>
        ) : result?.kind === "text" ? (
          <pre className="p-0 text-xs font-mono leading-5 min-w-full">
            {result.content.split("\n").map((line, idx) => {
              const lineNumber = idx + 1;
              const isMatched = selectedLine === lineNumber;
              return (
                <div
                  key={idx}
                  ref={isMatched ? lineRef : undefined}
                  className={
                    "flex " +
                    (isMatched
                      ? "bg-yellow-500/15"
                      : "hover:bg-accent/30")
                  }
                >
                  <span className="select-none tabular-nums text-right pr-3 pl-3 text-muted-foreground/60 border-r border-border/30 min-w-[3.5rem]">
                    {lineNumber}
                  </span>
                  <span className="pl-3 pr-4 whitespace-pre text-foreground/90 flex-1">
                    {line || " "}
                  </span>
                </div>
              );
            })}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
