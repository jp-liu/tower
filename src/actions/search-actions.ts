"use server";

import { search, type SearchResult, type SearchCategory } from "@/lib/search";
import { getConfigValues } from "@/actions/config-actions";

// Re-export types for existing consumers (per D-05)
export type { SearchResult, SearchCategory };
export type { SearchResultType, SearchConfig } from "@/lib/search";

export async function globalSearch(
  query: string,
  category: SearchCategory = "task"
): Promise<SearchResult[]> {
  const cfg = await getConfigValues([
    "search.resultLimit",
    "search.allModeCap",
    "search.snippetLength",
  ]);
  return search(query, category, {
    resultLimit: (cfg["search.resultLimit"] as number) ?? 20,
    allModeCap: (cfg["search.allModeCap"] as number) ?? 5,
    snippetLength: (cfg["search.snippetLength"] as number) ?? 80,
  });
}
