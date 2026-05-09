import { Search } from "lucide-react";
import type { Extension } from "../types";

export const ripgrepExtension: Extension = {
  id: "rg",
  name: "代码搜索 (ripgrep)",
  description: "基于 rg 的全文代码搜索",
  icon: Search,
  sizeMB: 5,
  homepageUrl: "https://github.com/BurntSushi/ripgrep#installation",
  async check() {
    return { installed: false };
  },
  async install() {
    return { success: false, error: "not implemented" };
  },
};
