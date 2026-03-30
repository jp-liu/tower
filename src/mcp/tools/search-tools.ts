import { z } from "zod";
import { search, type SearchCategory } from "@/lib/search";
import { readConfigValue } from "@/lib/config-reader";

export const searchTools = {
  search: {
    description:
      "Search for tasks, projects, repositories, notes, or assets by a query string. Use category 'all' to search across all types.",
    schema: z.object({
      query: z.string(),
      category: z
        .enum(["task", "project", "repository", "note", "asset", "all"])
        .default("task")
        .optional(),
    }),
    handler: async (args: {
      query: string;
      category?: SearchCategory;
    }) => {
      const [resultLimit, allModeCap, snippetLength] = await Promise.all([
        readConfigValue<number>("search.resultLimit", 20),
        readConfigValue<number>("search.allModeCap", 5),
        readConfigValue<number>("search.snippetLength", 80),
      ]);
      return search(args.query, args.category ?? "task", {
        resultLimit,
        allModeCap,
        snippetLength,
      });
    },
  },
};
