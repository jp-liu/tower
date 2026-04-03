"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { loader } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n";
import { readFileContent, writeFileContent } from "@/actions/file-actions";
import { EditorTabs } from "./editor-tabs";
import type { EditorTab } from "./editor-tabs";

// Configure CDN loader at module level (D-01)
loader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs" },
});

// Dynamic import prevents SSR crash (D-01)
const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => ({ default: m.default })),
  { ssr: false }
);

const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  css: "css",
  html: "html",
  py: "python",
  sh: "shell",
  yaml: "yaml",
  yml: "yaml",
  prisma: "prisma",
  txt: "plaintext",
};

export interface CodeEditorProps {
  worktreePath: string;
  selectedFilePath: string | null;
  onFilePathChange?: (path: string | null) => void;
  onSave?: () => void;
}

export function CodeEditor({
  worktreePath,
  selectedFilePath,
  onFilePathChange,
  onSave,
}: CodeEditorProps) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "light";

  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    visible: boolean;
  }>({ type: "success", visible: false });

  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<unknown>(null);
  const modelsRef = useRef<Map<string, unknown>>(new Map());
  const activeTabRef = useRef<EditorTab | null>(null);
  const onSaveRef = useRef<(() => void) | undefined>(undefined);

  // Keep activeTabRef in sync with current state for use in Monaco action callbacks
  useEffect(() => {
    activeTabRef.current = tabs.find((t) => t.path === activeTabPath) ?? null;
  }, [tabs, activeTabPath]);

  // Keep onSaveRef in sync to avoid stale closure in Monaco addAction
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  function showToast(type: "success" | "error") {
    setToast({ type, visible: true });
    setTimeout(
      () => setToast((prev) => ({ ...prev, visible: false })),
      3000
    );
  }

  // Sync Monaco theme when resolvedTheme changes (D-05)
  useEffect(() => {
    import("@monaco-editor/react").then(({ loader: l }) => {
      l.init().then((monaco) => {
        (monaco as { editor: { setTheme: (t: string) => void } }).editor.setTheme(monacoTheme);
      });
    });
  }, [monacoTheme]);

  // React to selectedFilePath changes (D-04)
  useEffect(() => {
    if (!selectedFilePath) return;

    const existingTab = tabs.find((t) => t.path === selectedFilePath);
    if (existingTab) {
      setActiveTabPath(selectedFilePath);
      onFilePathChange?.(selectedFilePath);
      return;
    }

    // Derive relativePath (browser-safe, no path module)
    const relativePath = selectedFilePath.startsWith(worktreePath + "/")
      ? selectedFilePath.slice(worktreePath.length + 1)
      : selectedFilePath;

    const filename = relativePath.split("/").pop() ?? relativePath;

    readFileContent(worktreePath, relativePath)
      .then((content) => {
        const newTab: EditorTab = {
          path: selectedFilePath,
          relativePath,
          filename,
          content,
          isDirty: false,
        };

        setTabs((prev) => {
          // Double-check no race condition added same tab
          if (prev.some((t) => t.path === selectedFilePath)) return prev;
          return [...prev, newTab];
        });
        setActiveTabPath(selectedFilePath);
        onFilePathChange?.(selectedFilePath);
      })
      .catch(() => {
        // Silently fail — file may not be readable
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilePath, worktreePath]);

  // Create / switch Monaco model on active tab change
  useEffect(() => {
    const editor = editorRef.current as {
      setModel: (m: unknown) => void;
    } | null;
    const monaco = monacoRef.current as {
      editor: {
        createModel: (content: string, lang: string, uri: unknown) => unknown;
        getModel: (uri: unknown) => unknown | null;
      };
      Uri: { parse: (uri: string) => unknown };
    } | null;

    if (!editor || !monaco || !activeTabPath) return;

    const tab = tabs.find((t) => t.path === activeTabPath);
    if (!tab) return;

    const uri = monaco.Uri.parse("file://" + tab.path);
    let model = modelsRef.current.get(tab.path);
    if (!model) {
      const ext = tab.filename.split(".").pop() ?? "";
      const lang = LANG_MAP[ext] ?? "plaintext";
      model = monaco.editor.createModel(tab.content, lang, uri);
      modelsRef.current.set(tab.path, model);
    }
    editor.setModel(model);
  }, [activeTabPath, tabs]);

  function handleEditorMount(editor: unknown, monaco: unknown) {
    editorRef.current = editor;
    monacoRef.current = monaco;

    const e = editor as {
      addAction: (action: {
        id: string;
        label: string;
        keybindings: number[];
        run: () => Promise<void>;
      }) => void;
    };
    const m = monaco as {
      KeyMod: { CtrlCmd: number };
      KeyCode: { KeyS: number };
    };

    e.addAction({
      id: "save-file",
      label: "Save File",
      keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.KeyS],
      run: async () => {
        const tab = activeTabRef.current;
        if (!tab || !tab.isDirty) return;
        try {
          await writeFileContent(worktreePath, tab.relativePath, tab.content);
          setTabs((prev) =>
            prev.map((t) =>
              t.path === tab.path ? { ...t, isDirty: false } : t
            )
          );
          showToast("success");
          onSaveRef.current?.();
        } catch {
          showToast("error");
        }
      },
    });
  }

  function handleTabClick(path: string) {
    setActiveTabPath(path);
    onFilePathChange?.(path);
  }

  function handleTabClose(path: string) {
    // Dispose Monaco model
    const model = modelsRef.current.get(path) as {
      dispose?: () => void;
    } | undefined;
    if (model?.dispose) model.dispose();
    modelsRef.current.delete(path);

    setTabs((prev) => {
      const filtered = prev.filter((t) => t.path !== path);
      // If closing the active tab, switch to last remaining tab
      if (activeTabPath === path) {
        const newActive = filtered.length > 0 ? filtered[filtered.length - 1].path : null;
        setActiveTabPath(newActive);
        onFilePathChange?.(newActive);
      }
      return filtered;
    });
  }

  const activeTab = tabs.find((t) => t.path === activeTabPath);

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <EditorTabs
        tabs={tabs}
        activeTabPath={activeTabPath}
        onTabClick={handleTabClick}
        onTabClose={handleTabClose}
      />

      {tabs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <p className="text-sm text-muted-foreground">
            {t("editor.selectFile")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("editor.selectFileHint")}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <MonacoEditor
            height="100%"
            theme={monacoTheme}
            value={activeTab?.content ?? ""}
            onMount={handleEditorMount}
            onChange={(value) => {
              if (value === undefined) return;
              setTabs((prev) =>
                prev.map((t) =>
                  t.path === activeTabPath
                    ? { ...t, content: value, isDirty: true }
                    : t
                )
              );
            }}
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: '"JetBrains Mono", "Geist Mono", monospace',
              lineNumbers: "on",
              wordWrap: "off",
              scrollBeyondLastLine: false,
              tabSize: 2,
            }}
            loading={
              <div className="flex h-full items-center justify-center bg-muted/20">
                <span className="text-sm text-muted-foreground">Loading editor...</span>
              </div>
            }
          />
        </div>
      )}

      {/* Toast notification (D-07) */}
      {toast.visible && (
        <div
          className={[
            "absolute bottom-4 right-4 z-50 rounded-md px-4 py-2 text-sm shadow-md text-white",
            toast.type === "success" ? "bg-green-600" : "bg-destructive",
          ].join(" ")}
        >
          {toast.type === "success" ? t("editor.saveSuccess") : t("editor.saveError")}
        </div>
      )}
    </div>
  );
}
