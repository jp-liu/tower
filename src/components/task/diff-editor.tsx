"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { loader } from "@monaco-editor/react";
import { useTheme } from "next-themes";

loader.config({
  paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs" },
});

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })),
  { ssr: false }
);

export interface DiffEditorViewProps {
  originalContent: string;
  modifiedContent: string;
  filePath: string;
  language?: string;
  onModifiedChange?: (value: string) => void;
  readOnly?: boolean;
}

const LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript",
  json: "json", md: "markdown",
  css: "css", html: "html",
  py: "python", sh: "shell",
  yaml: "yaml", yml: "yaml",
  vue: "html", svelte: "html",
  prisma: "prisma", txt: "plaintext",
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop() ?? "";
  return LANG_MAP[ext] ?? "plaintext";
}

export function DiffEditorView({
  originalContent,
  modifiedContent,
  filePath,
  language,
  onModifiedChange,
  readOnly = false,
}: DiffEditorViewProps) {
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "light";
  const lang = language ?? detectLanguage(filePath);
  const editorRef = useRef<unknown>(null);

  useEffect(() => {
    import("@monaco-editor/react").then(({ loader: l }) => {
      l.init().then((monaco) => {
        (monaco as { editor: { setTheme: (t: string) => void } }).editor.setTheme(monacoTheme);
      });
    });
  }, [monacoTheme]);

  return (
    <MonacoDiffEditor
      height="100%"
      theme={monacoTheme}
      original={originalContent}
      modified={modifiedContent}
      language={lang}
      onMount={(editor) => {
        editorRef.current = editor;
        if (onModifiedChange) {
          const modifiedEditor = (editor as { getModifiedEditor: () => { onDidChangeModelContent: (cb: () => void) => void; getValue: () => string } }).getModifiedEditor();
          modifiedEditor.onDidChangeModelContent(() => {
            onModifiedChange(modifiedEditor.getValue());
          });
        }
      }}
      options={{
        readOnly,
        originalEditable: false,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: '"JetBrains Mono", "Geist Mono", monospace',
        scrollBeyondLastLine: false,
        renderSideBySide: true,
      }}
      loading={
        <div className="flex h-full items-center justify-center bg-muted/20">
          <span className="text-sm text-muted-foreground">Loading diff editor...</span>
        </div>
      }
    />
  );
}
