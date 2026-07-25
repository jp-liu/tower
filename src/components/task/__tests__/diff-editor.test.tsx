import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, cleanup, act } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Captured-ref pattern: record the last props passed to MonacoDiffEditor
// ---------------------------------------------------------------------------
let captured: { original: string; modified: string } | null = null;

// ---------------------------------------------------------------------------
// Mock @monaco-editor/react
// The component does:
//   dynamic(() => import("@monaco-editor/react").then(m => ({ default: m.DiffEditor })))
// We expose DiffEditor as a recording stub that captures original/modified props.
// ---------------------------------------------------------------------------
vi.mock("@monaco-editor/react", () => {
  const DiffEditorMock = ({
    original,
    modified,
  }: {
    original?: string;
    modified?: string;
    [key: string]: unknown;
  }) => {
    captured = { original: original ?? "", modified: modified ?? "" };
    return null;
  };
  return {
    loader: {
      config: vi.fn(),
      init: () => Promise.resolve({ editor: { setTheme: vi.fn() } }),
    },
    default: () => null,
    DiffEditor: DiffEditorMock,
  };
});

// ---------------------------------------------------------------------------
// Mock next/dynamic — resolve the loader synchronously in tests
// ---------------------------------------------------------------------------
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>) => {
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
// Mock next-themes
// ---------------------------------------------------------------------------
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Now import the component under test (after all mocks are set up)
// ---------------------------------------------------------------------------
import { DiffEditorView } from "@/components/task/diff-editor";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DiffEditorView — CRLF normalization", () => {
  afterEach(() => {
    captured = null;
    cleanup();
  });

  it("normalizes CRLF to LF in both original and modified before passing to Monaco", async () => {
    await act(async () => {
      render(
        <DiffEditorView
          originalContent={"a\r\nb\r\n"}
          modifiedContent={"a\nb\nc\n"}
          filePath="x.ts"
        />
      );
    });

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });

    expect(captured).toEqual({
      original: "a\nb\n",
      modified: "a\nb\nc\n",
    });
  });
});
