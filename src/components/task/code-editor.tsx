"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { loader } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { FileWarning, FileX, Clock } from "lucide-react";
import { readFileContent, writeFileContent, readFileContentForce } from "@/actions/file-actions";
import { Button } from "@/components/ui/button";
import { EditorTabs } from "./editor-tabs";
import type { EditorTab } from "./editor-tabs";
import { DiffEditorView } from "./diff-editor";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { gitAction } from "@/lib/git-api";
import { parseUnifiedDiff } from "@/lib/git-diff";
import { applyGutterDecorations, chunksToGutterHunks } from "@/lib/monaco-gutter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { FileHistoryPanel } from "./file-history-panel";
import { type BlameLine, formatBlameAge } from "./blame-overlay";

type GuardInfo =
  | { kind: "oversized"; size: number; limit: number }
  | { kind: "binary"; size: number };

// Load Monaco from local public/vs (copied from node_modules by postinstall script)
loader.config({
  paths: { vs: "/vs" },
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
  vue: "html",
  svelte: "html",
  prisma: "prisma",
  txt: "plaintext",
};

export interface DiffFileRequest {
  relativePath: string;
  originalContent: string;
}

export interface CodeEditorProps {
  worktreePath: string;
  selectedFilePath: string | null;
  onFilePathChange?: (path: string | null) => void;
  onSave?: () => void;
  selectedLine?: number | null;
  diffFileRequest?: DiffFileRequest | null;
}

export function CodeEditor({
  worktreePath,
  selectedFilePath,
  onFilePathChange,
  onSave,
  selectedLine,
  diffFileRequest,
}: CodeEditorProps) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "light";

  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [guardByPath, setGuardByPath] = useState<Map<string, GuardInfo>>(new Map());
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [monacoReady, setMonacoReady] = useState(false);
  const [gutterTick, setGutterTick] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<unknown>(null);
  const modelsRef = useRef<Map<string, unknown>>(new Map());
  const activeTabRef = useRef<EditorTab | null>(null);
  const activeTabPathRef = useRef<string | null>(null);
  const onSaveRef = useRef<(() => void) | undefined>(undefined);
  const latestFilePathRef = useRef<string | null>(null);
  // Inline blame: cache per-tab line data + track current decoration IDs
  const blameByTabRef = useRef<Map<string, BlameLine[]>>(new Map());
  const blameDecorationsRef = useRef<string[]>([]);

  // Dispose all Monaco models on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      modelsRef.current.forEach((model) => {
        const m = model as { dispose?: () => void };
        m?.dispose?.();
      });
      modelsRef.current.clear();
    };
  }, []);

  // Keep refs in sync with current state for use in Monaco callbacks (avoids stale closures)
  useEffect(() => {
    activeTabRef.current = tabs.find((t) => t.path === activeTabPath) ?? null;
    activeTabPathRef.current = activeTabPath;
  }, [tabs, activeTabPath]);

  // Keep onSaveRef in sync to avoid stale closure in Monaco addAction
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Sync Monaco theme when resolvedTheme changes (D-05)
  useEffect(() => {
    import("@monaco-editor/react").then(({ loader: l }) => {
      l.init().then((monaco) => {
        (monaco as { editor: { setTheme: (t: string) => void } }).editor.setTheme(monacoTheme);
      });
    });
  }, [monacoTheme]);

  // React to selectedFilePath changes (D-04)
  // Use a generation counter to prevent race conditions when rapidly clicking files.
  // Each click increments the counter; stale async completions are discarded.
  const fileLoadGenRef = useRef(0);

  useEffect(() => {
    if (!selectedFilePath) return;

    // Track latest request to ignore stale async completions
    latestFilePathRef.current = selectedFilePath;
    const thisGen = ++fileLoadGenRef.current;

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
    const requestedPath = selectedFilePath;

    const loadOnce = () => {
      readFileContent(worktreePath, relativePath)
        .then((result) => {
          // Ignore if user has already clicked a different file (generation mismatch)
          if (fileLoadGenRef.current !== thisGen) return;

          if (result.kind !== "text") {
            // Oversized or binary — store guard info and open empty tab as a placeholder host
            setGuardByPath((prev) => {
              const next = new Map(prev);
              next.set(requestedPath, result);
              return next;
            });
            const newTab: EditorTab = {
              path: requestedPath,
              relativePath,
              filename,
              content: "",
              isDirty: false,
            };
            setTabs((prev) => (prev.some((t) => t.path === requestedPath) ? prev : [...prev, newTab]));
            setActiveTabPath(requestedPath);
            onFilePathChange?.(requestedPath);
            return;
          }

          const newTab: EditorTab = {
            path: requestedPath,
            relativePath,
            filename,
            content: result.content,
            isDirty: false,
          };

          setTabs((prev) => {
            if (prev.some((t) => t.path === requestedPath)) return prev;
            return [...prev, newTab];
          });
          setActiveTabPath(requestedPath);
          onFilePathChange?.(requestedPath);
        })
        .catch(() => {
          toast.error(t("codeEditor.readError"), {
            action: { label: t("codeEditor.retryAction"), onClick: loadOnce },
          });
        });
    };
    loadOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilePath, worktreePath]);

  // React to diffFileRequest — open file in diff mode
  useEffect(() => {
    if (!diffFileRequest) return;
    const { relativePath, originalContent } = diffFileRequest;
    const absolutePath = worktreePath + "/" + relativePath;
    const diffTabKey = "diff:" + absolutePath;
    const filename = relativePath.split("/").pop() ?? relativePath;

    // If diff tab already open, just switch to it
    const existing = tabs.find((t) => t.path === diffTabKey);
    if (existing) {
      setActiveTabPath(diffTabKey);
      return;
    }

    const loadDiffOnce = () => {
      readFileContent(worktreePath, relativePath)
        .then((result) => {
          if (result.kind !== "text") {
            // Diff mode does not support placeholder cards — surface the guard reason as a plain toast.
            toast.error(
              t(
                result.kind === "oversized"
                  ? "codeEditor.fileGuard.oversizedTitle"
                  : "codeEditor.fileGuard.binaryTitle"
              )
            );
            return;
          }
          const newTab: EditorTab = {
            path: diffTabKey,
            relativePath,
            filename,
            content: result.content,
            isDirty: false,
            isDiff: true,
            originalContent,
          };
          setTabs((prev) => {
            if (prev.some((t) => t.path === diffTabKey)) return prev;
            return [...prev, newTab];
          });
          setActiveTabPath(diffTabKey);
        })
        .catch(() => {
          toast.error(t("codeEditor.readError"), {
            action: { label: t("codeEditor.retryAction"), onClick: loadDiffOnce },
          });
        });
    };
    loadDiffOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffFileRequest, worktreePath]);

  // Scroll Monaco to selectedLine when it changes (or active tab changes)
  useEffect(() => {
    if (!selectedLine || !editorRef.current) return;
    const editor = editorRef.current as {
      revealLineInCenter: (line: number) => void;
      setPosition: (pos: { lineNumber: number; column: number }) => void;
    };
    // Delay 50ms to let Monaco finish loading the model
    const timer = setTimeout(() => {
      editor.revealLineInCenter(selectedLine);
      editor.setPosition({ lineNumber: selectedLine, column: 1 });
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedLine, activeTabPath]);

  // Create / switch Monaco model on active tab change.
  // We own the model lifecycle here — DO NOT pass `value` to <MonacoEditor>,
  // it would call editor.setValue() on the current model (= previous tab's model)
  // every render, scrambling content across tabs.
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
    // Diff tabs are rendered via <DiffEditorView> with its own Monaco instance.
    // Don't touch the main editor's model for them (URI like "file://diff:..."
    // would also be malformed and could throw on Uri.parse / createModel).
    if (tab.isDiff) return;

    const uri = monaco.Uri.parse("file://" + tab.path);
    let model = modelsRef.current.get(tab.path) as
      | { getValue: () => string; setValue: (v: string) => void; isDisposed?: () => boolean }
      | undefined;
    // Defensive: if the cached model was disposed by Monaco (e.g. an unexpected
    // editor remount without keepCurrentModel), evict and recreate. Otherwise
    // setModel(disposedModel) throws "Model is disposed!" from Monaco.
    if (model && model.isDisposed?.()) {
      modelsRef.current.delete(tab.path);
      model = undefined;
    }
    if (!model) {
      const ext = tab.filename.split(".").pop() ?? "";
      const lang = LANG_MAP[ext] ?? "plaintext";
      model = monaco.editor.createModel(tab.content, lang, uri) as typeof model;
      modelsRef.current.set(tab.path, model);
    } else if (!tab.isDirty && model.getValue() !== tab.content) {
      // External content update (force-open, refresh) — sync to model
      // Skip if user has unsaved edits, otherwise we'd erase their work.
      model.setValue(tab.content);
    }
    editor.setModel(model);
  }, [activeTabPath, tabs, monacoReady]);

  // Fetch git diff and apply VSCode-style gutter decorations.
  // Deps: activeTabPath, monacoReady, gutterTick, worktreePath.
  // Intentionally excludes `tabs` to avoid re-firing on every keystroke;
  // activeTabRef.current is kept in sync by a separate effect above.
  useEffect(() => {
    if (!monacoReady || !activeTabPath || !worktreePath) return;
    const activeTab = activeTabRef.current;
    if (!activeTab || activeTab.isDiff) return; // skip diff tabs

    const handle = setTimeout(async () => {
      try {
        const res = await gitAction(worktreePath, "diff-file", { file: activeTab.relativePath });
        const patch = (res as { patch?: string }).patch ?? "";
        if (!patch) return; // file not tracked or no changes
        const files = parseUnifiedDiff(patch);
        const hunks = chunksToGutterHunks(files[0]?.chunks ?? []);
        const ed = editorRef.current as Parameters<typeof applyGutterDecorations>[0] | null;
        const m = monacoRef.current as Parameters<typeof applyGutterDecorations>[1] | null;
        if (ed && m) applyGutterDecorations(ed, m, hunks);
      } catch {
        // file may not be in a git repo, or worktree gone — silently ignore
      }
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabPath, monacoReady, gutterTick, worktreePath]);

  // Inline blame: fetch per-file blame data on tab activation, cache it,
  // and apply the after-line annotation on the current cursor line.
  // Uses the same passive "fail silent if not in git" pattern as the gutter.
  const updateBlameAnnotation = useRef<() => void>(() => {});

  useEffect(() => {
    if (!monacoReady || !activeTabPath || !worktreePath) return;
    const activeTab = activeTabRef.current;
    if (!activeTab || activeTab.isDiff) return;

    const tabPath = activeTab.path;
    const relativePath = activeTab.relativePath;

    const applyForCurrentLine = () => {
      const ed = editorRef.current as {
        getPosition: () => { lineNumber: number; column: number } | null;
        deltaDecorations: (oldIds: string[], next: unknown[]) => string[];
      } | null;
      const m = monacoRef.current as { Range: new (a: number, b: number, c: number, d: number) => unknown } | null;
      if (!ed || !m) return;
      const blame = blameByTabRef.current.get(tabPath);
      const pos = ed.getPosition();
      if (!blame || !pos) {
        blameDecorationsRef.current = ed.deltaDecorations(blameDecorationsRef.current, []);
        return;
      }
      const entry = blame.find((b) => b.line === pos.lineNumber);
      if (!entry) {
        blameDecorationsRef.current = ed.deltaDecorations(blameDecorationsRef.current, []);
        return;
      }
      // Uncommitted line (sha is all zeros) — skip annotation
      if (/^0+$/.test(entry.sha)) {
        blameDecorationsRef.current = ed.deltaDecorations(blameDecorationsRef.current, []);
        return;
      }
      const age = formatBlameAge(entry.date);
      const text = `   ${entry.author}, ${age} · ${entry.summary}`.replace(/\n/g, " ");
      blameDecorationsRef.current = ed.deltaDecorations(blameDecorationsRef.current, [
        {
          range: new m.Range(pos.lineNumber, 1, pos.lineNumber, 1),
          options: {
            after: {
              content: text,
              inlineClassName: "blame-inline-annotation",
            },
          },
        },
      ]);
    };
    updateBlameAnnotation.current = applyForCurrentLine;

    if (blameByTabRef.current.has(tabPath)) {
      applyForCurrentLine();
      return;
    }
    let cancelled = false;
    gitAction(worktreePath, "blame", { file: relativePath })
      .then((res) => {
        if (cancelled) return;
        const data = res as { lines?: BlameLine[] };
        blameByTabRef.current.set(tabPath, data.lines ?? []);
        applyForCurrentLine();
      })
      .catch(() => {
        if (cancelled) return;
        blameByTabRef.current.set(tabPath, []);
      });
    return () => { cancelled = true; };
  }, [activeTabPath, monacoReady, worktreePath]);

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

    const saveActiveTab = async () => {
      const tab = activeTabRef.current;
      if (!tab || !tab.isDirty) return;
      try {
        await writeFileContent(worktreePath, tab.relativePath, tab.content);
        setTabs((prev) =>
          prev.map((tt) =>
            tt.path === tab.path ? { ...tt, isDirty: false } : tt
          )
        );
        setGutterTick((t) => t + 1);
        toast.success(t("editor.saveSuccess"));
        onSaveRef.current?.();
      } catch {
        toast.error(t("editor.saveError"), {
          action: { label: t("codeEditor.retryAction"), onClick: () => { void saveActiveTab(); } },
        });
      }
    };

    e.addAction({
      id: "save-file",
      label: "Save File",
      keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.KeyS],
      run: saveActiveTab,
    });

    // Inline blame: redraw the after-line annotation whenever the cursor moves.
    // Optional chaining for the test mock which doesn't expose this listener.
    const cursorAware = editor as {
      onDidChangeCursorPosition?: (cb: () => void) => void;
    };
    cursorAware.onDidChangeCursorPosition?.(() => {
      updateBlameAnnotation.current();
    });

    setMonacoReady(true);
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

    // Clear guard entry if present (oversized/binary placeholder)
    setGuardByPath((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Map(prev);
      next.delete(path);
      return next;
    });

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
  // Show History button only when a regular (non-diff) editable tab is active
  const showHistoryButton = activeTab !== undefined && !activeTab.isDiff;

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      <div className="flex items-center">
        <EditorTabs
          tabs={tabs}
          activeTabPath={activeTabPath}
          onTabClick={handleTabClick}
          onTabClose={handleTabClose}
        />
        {showHistoryButton && (
          <Tooltip>
            <TooltipTrigger
              onClick={() => setHistoryOpen(true)}
              className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label={t("git.history")}
              data-testid="history-button"
            >
              <Clock className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("git.history")}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {tabs.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <p className="text-sm text-muted-foreground">
            {t("editor.selectFile")}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("editor.selectFileHint")}
          </p>
        </div>
      ) : activeTab && guardByPath.has(activeTab.path) ? (
        (() => {
          const guard = guardByPath.get(activeTab.path)!;
          const isOversized = guard.kind === "oversized";
          const Icon = isOversized ? FileWarning : FileX;
          const title = t(
            isOversized
              ? "codeEditor.fileGuard.oversizedTitle"
              : "codeEditor.fileGuard.binaryTitle"
          );
          const sizeStr = `${(guard.size / 1024 / 1024).toFixed(2)} MB`;
          const limitStr = isOversized
            ? `${(guard.limit / 1024 / 1024).toFixed(2)} MB`
            : "";
          const desc = t(
            isOversized
              ? "codeEditor.fileGuard.oversizedBody"
              : "codeEditor.fileGuard.binaryBody"
          )
            .replace("{size}", sizeStr)
            .replace("{limit}", limitStr);

          return (
            <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 p-6 text-center">
              <Icon className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">{title}</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-[360px]">{desc}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  toast.warning(t("codeEditor.fileGuard.forceOpenWarning"));
                  readFileContentForce(worktreePath, activeTab.relativePath)
                    .then(({ content }) => {
                      // Force-open replaces the placeholder content in the SAME tab.
                      // Clearing the guard entry causes this branch to no longer match,
                      // so the editor will render the now-populated tab.content normally.
                      setGuardByPath((prev) => {
                        const next = new Map(prev);
                        next.delete(activeTab.path);
                        return next;
                      });
                      setTabs((prev) =>
                        prev.map((tt) =>
                          tt.path === activeTab.path
                            ? { ...tt, content, isDirty: false }
                            : tt
                        )
                      );
                    })
                    .catch(() => toast.error(t("codeEditor.readError")));
                }}
              >
                {t("codeEditor.fileGuard.forceOpenAction")}
              </Button>
            </div>
          );
        })()
      ) : activeTab?.isDiff ? (
        <div className="flex-1 min-h-0">
          <ErrorBoundary>
            <DiffEditorView
              originalContent={activeTab.originalContent ?? ""}
              modifiedContent={activeTab.content}
              filePath={activeTab.relativePath}
              onModifiedChange={(value) => {
                const currentPath = activeTabPathRef.current;
                if (!currentPath) return;
                setTabs((prev) =>
                  prev.map((t) =>
                    t.path === currentPath
                      ? { ...t, content: value, isDirty: true }
                      : t
                  )
                );
              }}
            />
          </ErrorBoundary>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ErrorBoundary>
          <MonacoEditor
            height="100%"
            theme={monacoTheme}
            defaultValue=""
            // Survive component unmount (we own model lifecycle via modelsRef +
            // unmount-cleanup effect). Without this, switching to a diff tab
            // unmounts MonacoEditor → disposes the active model → re-clicking
            // the tab triggers "Model is disposed!" on setModel.
            keepCurrentModel
            onMount={handleEditorMount}
            onChange={(value) => {
              if (value === undefined) return;
              // Use ref to get the current active tab path, avoiding stale closure
              // during rapid tab switches
              const currentPath = activeTabPathRef.current;
              if (!currentPath) return;
              setTabs((prev) =>
                prev.map((t) =>
                  t.path === currentPath
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
          </ErrorBoundary>
        </div>
      )}


      {/* File history dialog */}
      {showHistoryButton && activeTab && (
        <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
          <DialogContent className="w-[min(720px,90vw)] max-w-none sm:max-w-none flex flex-col" style={{ height: "min(540px, 80vh)" }}>
            <DialogHeader>
              <DialogTitle>{t("git.history")} — {activeTab.filename}</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-hidden">
              <FileHistoryPanel
                worktreePath={worktreePath}
                relativePath={activeTab.relativePath}
                onClose={() => setHistoryOpen(false)}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

    </div>
  );
}
