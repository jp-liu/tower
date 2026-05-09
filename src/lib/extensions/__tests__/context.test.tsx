import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ExtensionProvider } from "../context";
import { useExtension } from "../client";

vi.mock("@/actions/extension-actions", () => ({
  listAllExtensionStatus: vi.fn().mockResolvedValue({
    rg: { installed: true, version: "14.1.1" },
    monaco: { installed: false },
  }),
  checkExtension: vi.fn(),
  installExtension: vi.fn(),
  uninstallExtension: vi.fn(),
}));

function Probe() {
  const rg = useExtension("rg");
  const monaco = useExtension("monaco");
  return (
    <>
      <span data-testid="rg-installed">{String(rg.status.installed)}</span>
      <span data-testid="rg-version">{rg.status.version ?? ""}</span>
      <span data-testid="monaco-installed">{String(monaco.status.installed)}</span>
    </>
  );
}

describe("ExtensionProvider + useExtension", () => {
  it("hydrates initial status and propagates to consumers", async () => {
    render(
      <ExtensionProvider>
        <Probe />
      </ExtensionProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("rg-installed").textContent).toBe("true");
      expect(screen.getByTestId("rg-version").textContent).toBe("14.1.1");
      expect(screen.getByTestId("monaco-installed").textContent).toBe("false");
    });
  });
});
