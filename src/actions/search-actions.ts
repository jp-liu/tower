"use server";

import { search } from "@/lib/search";
import type { SearchResult, SearchCategory } from "@/lib/search";
import { getConfigValues } from "@/actions/config-actions";

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
