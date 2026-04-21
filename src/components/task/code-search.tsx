"use client";

import { useState, useCallback, useRef } from "react";
import { Search, Filter, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { searchCode } from "@/actions/search-code-actions";
import type { SearchMatch } from "@/actions/search-code-actions";

interface CodeSearchProps {
  localPath: string | null;
  onResultSelect: (absolutePath: string, lineNumber: number) => void;
}

function renderHighlighted(
  lineText: string,
  submatches: Array<{ start: number; end: number }>
): React.ReactNode[] {
  if (!submatches.length) return [<span key="0">{lineText}</span>];

  const nodes: React.ReactNode[] = [];
  let pos = 0;

  for (const { start, end } of submatches) {
    if (pos < start) {
      nodes.push(<span key={`plain-${pos}`}>{lineText.slice(pos, start)}</span>);
    }
    nodes.push(
      <span
        key={`match-${start}`}
        className="bg-yellow-400/30 text-yellow-200 rounded-[2px] px-[1px]"
      >
        {lineText.slice(start, end)}
      </span>
    );
    pos = end;
  }

  if (pos < lineText.length) {
    nodes.push(<span key={`plain-${pos}`}>{lineText.slice(pos)}</span>);
  }

  return nodes;
}

export function CodeSearch({ localPath, onResultSelect }: CodeSearchProps) {
  const { t } = useI18n();
  const [pattern, setPattern] = useState("");
  const [glob, setGlob] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const generationRef = useRef(0);

  const handleSearch = useCallback(async () => {
    if (!localPath || !pattern.trim()) return;

    // Increment generation to cancel any in-flight search
    const thisGeneration = ++generationRef.current;

    setIsSearching(true);
    setError(null);
    setHasSearched(true);

    try {
      const result = await searchCode(
        localPath,
        pattern.trim(),
        glob.trim() || undefined
      );

      if (thisGeneration !== generationRef.current) return;

      if (result.error) {
        // Check if it's a rg-not-installed error
        if (
          result.error.toLowerCase().includes("ripgrep") ||
          result.error.toLowerCase().includes("rg")
        ) {
          toast.error(t("codeSearch.rgNotInstalled"));
          setError(t("codeSearch.rgNotInstalled"));
        } else {
          setError(result.error);
        }
        setResults([]);
        setTruncated(false);
      } else {
        setResults(result.matches);
        setTruncated(result.truncated);
      }
    } catch (err) {
      if (thisGeneration !== generationRef.current) return;
      setError(String(err));
      setResults([]);
      setTruncated(false);
    } finally {
      if (thisGeneration === generationRef.current) {
        setIsSearching(false);
      }
    }
  }, [localPath, pattern, glob, t]);

  const handlePatternKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSearch();
      }
    },
    [handleSearch]
  );

  if (!localPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <Search className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t("codeSearch.noPath")}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search inputs */}
      <div className="flex-shrink-0 px-2 py-1.5 space-y-1 border-b border-border">
        {/* Pattern input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={pattern}
            placeholder={t("codeSearch.patternPlaceholder")}
            className="w-full h-7 pl-7 pr-2 text-xs bg-muted/50 border border-border rounded-md outline-none focus:border-primary/50 focus:bg-background transition-colors placeholder:text-muted-foreground/60"
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={handlePatternKeyDown}
          />
        </div>

        {/* Glob filter input */}
        <div className="relative">
          <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={glob}
            placeholder={t("codeSearch.globPlaceholder")}
            className="w-full h-7 pl-7 pr-2 text-xs bg-muted/50 border border-border rounded-md outline-none focus:border-primary/50 focus:bg-background transition-colors placeholder:text-muted-foreground/60"
            onChange={(e) => setGlob(e.target.value)}
          />
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {isSearching ? (
          <div className="flex flex-col items-center justify-center h-full gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{t("codeSearch.searching")}</p>
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-xs text-destructive">
            {error}
          </div>
        ) : !hasSearched ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-muted-foreground text-center px-4">
              {t("codeSearch.hint")}
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-muted-foreground">{t("codeSearch.noResults")}</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="py-1">
              {results.map((match, index) => (
                <button
                  key={`${match.filePath}:${match.lineNumber}:${index}`}
                  type="button"
                  className="w-full flex flex-col gap-0.5 px-2 py-1.5 text-left hover:bg-accent/50 cursor-pointer border-b border-border/30 last:border-b-0"
                  onClick={() => {
                    const absolutePath = localPath.endsWith("/")
                      ? localPath + match.filePath
                      : localPath + "/" + match.filePath;
                    onResultSelect(absolutePath, match.lineNumber);
                  }}
                >
                  {/* File path + line number row */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs text-muted-foreground truncate flex-1">
                      {match.filePath}
                    </span>
                    <span className="text-xs text-primary/80 flex-shrink-0 tabular-nums">
                      :{match.lineNumber}
                    </span>
                  </div>
                  {/* Line text with highlights */}
                  <div className="text-xs text-foreground/80 font-mono truncate">
                    {renderHighlighted(match.lineText, match.submatches)}
                  </div>
                </button>
              ))}
            </div>

            {truncated && (
              <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border/30">
                {t("codeSearch.truncated")}
              </div>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
