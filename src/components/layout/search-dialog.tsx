"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, FolderKanban, GitBranch, StickyNote, Package2, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { globalSearch, type SearchResult, type SearchResultType, type SearchCategory } from "@/actions/search-actions";
import { getConfigValue } from "@/actions/config-actions";
import { useI18n } from "@/lib/i18n";

type CategoryKey =
  | "search.all"
  | "search.task"
  | "search.project"
  | "search.repository"
  | "search.note"
  | "search.asset";

const CATEGORY_DEFS: { id: SearchCategory; key: CategoryKey; icon: typeof FileText }[] = [
  { id: "all",        key: "search.all",        icon: Search },
  { id: "task",       key: "search.task",        icon: FileText },
  { id: "project",    key: "search.project",     icon: FolderKanban },
  { id: "repository", key: "search.repository",  icon: GitBranch },
  { id: "note",       key: "search.note",        icon: StickyNote },
  { id: "asset",      key: "search.asset",       icon: Package2 },
];

const SECTION_ORDER: SearchResultType[] = ["task", "project", "repository", "note", "asset"];

const SECTION_KEY_MAP: Record<SearchResultType, CategoryKey> = {
  task:       "search.task",
  project:    "search.project",
  repository: "search.repository",
  note:       "search.note",
  asset:      "search.asset",
};

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ResultRow({ result, onSelect }: { result: SearchResult; onSelect: (r: SearchResult) => void }) {
  const Icon = CATEGORY_DEFS.find((c) => c.id === result.type)?.icon ?? FileText;
  return (
    <button
      onClick={() => onSelect(result)}
      className="flex w-full items-center gap-3 border-b border-border/30 px-4 py-3 text-left transition-colors hover:bg-accent last:border-b-0"
    >
      <div className="rounded-md bg-muted p-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{result.title}</div>
        <div className="text-xs text-muted-foreground truncate">{result.subtitle}</div>
        {result.snippet && (
          <div className="text-xs text-muted-foreground/70 truncate mt-0.5">{result.snippet}</div>
        )}
      </div>
    </button>
  );
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory>("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [debounceMs, setDebounceMs] = useState(250);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reload config and reset state on dialog open
  useEffect(() => {
    if (open) {
      getConfigValue<number>("search.debounceMs", 250).then(setDebounceMs);
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery("");
      setResults([]);
    }
  }, [open]);

  // Debounced search with race condition fix
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); setIsSearching(false); return; }
    setIsSearching(true);

    let cancelled = false;

    timerRef.current = setTimeout(async () => {
      const r = await globalSearch(query, category);
      if (!cancelled) {
        setResults(r);
        setIsSearching(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      cancelled = true;
    };
  }, [query, category, debounceMs]);

  const handleSelect = useCallback((result: SearchResult) => {
    router.push(result.navigateTo);
    onOpenChange(false);
  }, [router, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden !top-[10vh] !-translate-y-0" showCloseButton={false}>
        {/* Search input */}
        <div className="flex items-center border-b border-border px-4">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="flex-1 bg-transparent px-3 py-3.5 text-sm text-foreground placeholder-muted-foreground outline-none"
          />
          {query && (
            <button onClick={() => { setQuery(""); setResults([]); }} className="rounded p-1 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-1 border-b border-border px-4 py-2">
          {CATEGORY_DEFS.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  category === cat.id
                    ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-3 w-3" />
                {t(cat.key)}
              </button>
            );
          })}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-auto">
          {!query.trim() && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t("search.typeToSearch")}
            </div>
          )}

          {query.trim() && results.length === 0 && !isSearching && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t("search.noResults")}
            </div>
          )}

          {/* Grouped rendering for All tab */}
          {category === "all" && results.length > 0 && (() => {
            const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
              (acc[r.type] ??= []).push(r);
              return acc;
            }, {});
            return SECTION_ORDER.filter((type) => grouped[type]?.length).map((type) => (
              <div key={type}>
                <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50">
                  {t(SECTION_KEY_MAP[type])}
                </div>
                {grouped[type].map((result) => (
                  <ResultRow key={`${result.type}-${result.id}`} result={result} onSelect={handleSelect} />
                ))}
              </div>
            ));
          })()}

          {/* Flat rendering for specific category tabs */}
          {category !== "all" && results.map((result) => (
            <ResultRow key={`${result.type}-${result.id}`} result={result} onSelect={handleSelect} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
