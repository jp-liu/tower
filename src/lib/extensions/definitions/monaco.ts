import { FileCode } from "lucide-react";
import type { Extension } from "../types";

export const monacoExtension: Extension = {
  id: "monaco",
  name: "代码编辑器 (Monaco)",
  description: "VS Code 同款 Web 编辑器",
  icon: FileCode,
  sizeMB: 15,
  homepageUrl: "https://microsoft.github.io/monaco-editor/",
  async check() {
    return { installed: false };
  },
  async install() {
    return { success: false, error: "not implemented" };
  },
};
