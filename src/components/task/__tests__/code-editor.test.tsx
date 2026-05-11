import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, act, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock @/lib/git-api
// ---------------------------------------------------------------------------
vi.mock("@/lib/git-api", () => ({
  gitAction: vi.fn(() => Promise.resolve({ patch: "" })),
}));

// ---------------------------------------------------------------------------
// Mock @/lib/monaco-gutter
// ---------------------------------------------------------------------------
vi.mock("@/lib/monaco-gutter", () => ({
  applyGutterDecorations: vi.fn(),
  clearGutterDecorations: vi.fn(),
  chunksToGutterHunks: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Fakes for Monaco editor instance
// ---------------------------------------------------------------------------
const fakeModel = { getValue: vi.fn(() => ""), setValue: vi.fn() };
const fakeEditor = {
  setModel: vi.fn(),
  addAction: vi.fn(),
};
const fakeMonaco = {
  editor: {
    createModel: vi.fn<(content: string, language: string, uri: unknown) => unknown>(
      () => fakeModel
    ),
    getModel: vi.fn<(uri: unknown) => unknown | null>(() => null),
  },
  Uri: {
    parse: vi.fn<(uri: string) => { toString: () => string }>((uri: string) => ({
      toString: () => uri,
    })),
  },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyS: 83 },
};

// ---------------------------------------------------------------------------
// Mock @monaco-editor/react
// The component does:
//   dynamic(() => import("@monaco-editor/react").then(m => ({ default: m.default })))
// We mock the module so its `default` export is a React component that calls
// onMount(fakeEditor, fakeMonaco) synchronously on mount.
// ---------------------------------------------------------------------------
vi.mock("@monaco-editor/react", () => {
  const EditorMock = ({ onMount }: { onMount?: (e: unknown, m: unknown) => void }) => {
    if (onMount) {
      onMount(fakeEditor, fakeMonaco);
    }
    return null;
  };
  return {
    loader: {
      config: vi.fn(),
      init: () => Promise.resolve({ editor: { setTheme: vi.fn() } }),
    },
    default: EditorMock,
    DiffEditor: () => null,
  };
});

// ---------------------------------------------------------------------------
// Mock next/dynamic to render the dynamic component directly (no lazy loading)
// ---------------------------------------------------------------------------
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>, _opts?: unknown) => {
    // Return a component that renders what the loader resolves to.
    // We use a state-driven approach so we can call the loader synchronously
    // in tests by resolving the promise immediately.
    const LazyComponent = (props: Record<string, unknown>) => {
      const [Component, setComponent] = React.useState<React.ComponentType<unknown> | null>(null);

      React.useEffect(() => {
        loader().then(({ default: Comp }) => {
          setComponent(() => Comp);
        });
      }, []);

      if (!Component) return null;
      return <Component {...props} />;
    };
    return LazyComponent;
  },
}));

// ---------------------------------------------------------------------------
// Mock server actions
// ---------------------------------------------------------------------------
vi.mock("@/actions/file-actions", () => ({
  readFileContent: vi.fn(() =>
    Promise.resolve({ kind: "text", content: "console.log('a');" })
  ),
  readFileContentForce: vi.fn(() =>
    Promise.resolve({ content: "" })
  ),
  writeFileContent: vi.fn(() => Promise.resolve()),
  listDirectory: vi.fn(() => Promise.resolve([])),
  getGitStatus: vi.fn(() => Promise.resolve({})),
  createFile: vi.fn(() => Promise.resolve()),
  createDirectory: vi.fn(() => Promise.resolve()),
  renameEntry: vi.fn(() => Promise.resolve()),
  deleteEntry: vi.fn(() => Promise.resolve()),
  listAllFiles: vi.fn(() => Promise.resolve([])),
  revealInFinder: vi.fn(() => Promise.resolve()),
}));

// ---------------------------------------------------------------------------
// Mock next/cache (indirect import from server actions)
// ---------------------------------------------------------------------------
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ---------------------------------------------------------------------------
// Mock sonner (toast)
// ---------------------------------------------------------------------------
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock next-themes
// ---------------------------------------------------------------------------
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mock FileHistoryPanel (avoid real gitAction calls inside panel)
// ---------------------------------------------------------------------------
vi.mock("@/components/task/file-history-panel", () => ({
  FileHistoryPanel: ({ relativePath }: { relativePath: string }) => (
    <div data-testid="file-history-panel">{relativePath}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock BlameList (avoid real gitAction calls inside panel)
// ---------------------------------------------------------------------------
vi.mock("@/components/task/blame-overlay", () => ({
  BlameList: ({ relativePath }: { relativePath: string }) => (
    <div data-testid="blame-list-panel">{relativePath}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock Dialog (shadcn) — render children when open
// ---------------------------------------------------------------------------
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; onOpenChange?: (o: boolean) => void; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ---------------------------------------------------------------------------
// Now import the component under test (after all mocks are set up)
// ---------------------------------------------------------------------------
import { CodeEditor } from "@/components/task/code-editor";
import { I18nProvider } from "@/lib/i18n";
import { gitAction } from "@/lib/git-api";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function renderEditor(props: { worktreePath: string; selectedFilePath: string }) {
  return render(
    <I18nProvider>
      <CodeEditor {...props} />
    </I18nProvider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const mockGitAction = gitAction as ReturnType<typeof vi.fn>;

describe("CodeEditor — gutter decorations via gitAction diff-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeMonaco.editor.createModel.mockReturnValue(fakeModel);
    fakeMonaco.editor.getModel.mockReturnValue(null);
    fakeMonaco.Uri.parse.mockImplementation((uri: string) => ({ toString: () => uri }));
    mockGitAction.mockResolvedValue({ patch: "" });
  });

  afterEach(() => {
    cleanup();
  });

  it("calls gitAction('diff-file', ...) after Monaco mounts and active tab changes", async () => {
    await act(async () => {
      render(
        <I18nProvider>
          <CodeEditor worktreePath="/x" selectedFilePath="/x/a.ts" />
        </I18nProvider>
      );
    });

    // Wait for Monaco to mount + file to load, then wait for debounced gutter effect (300ms)
    await waitFor(
      () => {
        expect(mockGitAction).toHaveBeenCalledWith(
          "/x",
          "diff-file",
          expect.objectContaining({ file: "a.ts" })
        );
      },
      { timeout: 1000 }
    );
  });
});

describe("CodeEditor — first-tab syntax highlight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default mock returns after clearAllMocks
    fakeMonaco.editor.createModel.mockReturnValue(fakeModel);
    fakeMonaco.editor.getModel.mockReturnValue(null);
    fakeMonaco.Uri.parse.mockImplementation((uri: string) => ({ toString: () => uri }));
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a Monaco model with correct content, language and URI on first mount", async () => {
    await act(async () => {
      renderEditor({ worktreePath: "/x", selectedFilePath: "/x/a.ts" });
    });

    await waitFor(() => {
      // createModel must have been called exactly once
      expect(fakeMonaco.editor.createModel).toHaveBeenCalledTimes(1);
    });

    // Assert args: content, language, uri
    const [content, lang, uri] = fakeMonaco.editor.createModel.mock.calls[0];
    expect(content).toBe("console.log('a');");
    expect(lang).toBe("typescript");
    // Uri string form should end with "a.ts"
    expect((uri as { toString: () => string }).toString()).toMatch(/a\.ts$/);

    // setModel must have been called with the returned model
    expect(fakeEditor.setModel).toHaveBeenCalledWith(fakeModel);
  });
});

describe("CodeEditor — History button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeMonaco.editor.createModel.mockReturnValue(fakeModel);
    fakeMonaco.editor.getModel.mockReturnValue(null);
    fakeMonaco.Uri.parse.mockImplementation((uri: string) => ({ toString: () => uri }));
  });

  afterEach(() => {
    cleanup();
  });

  it("shows History button when a regular tab is active", async () => {
    await act(async () => {
      renderEditor({ worktreePath: "/x", selectedFilePath: "/x/a.ts" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("history-button")).toBeInTheDocument();
    });
  });

  it("opens FileHistoryPanel dialog when History button is clicked", async () => {
    await act(async () => {
      renderEditor({ worktreePath: "/x", selectedFilePath: "/x/a.ts" });
    });

    await waitFor(() => {
      expect(screen.getByTestId("history-button")).toBeInTheDocument();
    });

    // Dialog should not be open yet
    expect(screen.queryByTestId("file-history-panel")).not.toBeInTheDocument();

    // Click history button
    await act(async () => {
      fireEvent.click(screen.getByTestId("history-button"));
    });

    // Panel should now be visible
    await waitFor(() => {
      expect(screen.getByTestId("file-history-panel")).toBeInTheDocument();
    });
  });
});

// Blame button + dialog removed in favor of inline blame annotation
// (see updateBlameAnnotation in code-editor.tsx). Tests for the inline
// annotation flow would require mocking Monaco's onDidChangeCursorPosition,
// which the current test scaffolding doesn't expose — deferred to e2e.
