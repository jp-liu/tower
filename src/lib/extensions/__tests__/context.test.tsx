import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExtensionProvider } from "../context";
import { useExtension } from "../client";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("@/actions/extension-actions", () => ({
  checkExtension: vi.fn(),
  installExtension: vi.fn(),
  uninstallExtension: vi.fn(),
}));

const INITIAL_STATUS = {
  rg: { installed: true, version: "14.1.1" },
  monaco: { installed: false },
  "tower-agent-openclaw": { installed: false },
  "tower-agent-hermes": { installed: false },
};

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
      <ExtensionProvider initialStatus={INITIAL_STATUS}>
        <Probe />
      </ExtensionProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("rg-installed").textContent).toBe("true");
      expect(screen.getByTestId("rg-version").textContent).toBe("14.1.1");
      expect(screen.getByTestId("monaco-installed").textContent).toBe("false");
    });
  });

  it("isInstalling becomes true while install is in flight", async () => {
    const installModule = await import("@/actions/extension-actions");
    let resolveInstall: (v: { success: boolean }) => void = () => {};
    (installModule.installExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((r) => { resolveInstall = r; })
    );

    function InstallProbe() {
      const rg = useExtension("rg");
      return (
        <>
          <span data-testid="installing">{String(rg.isInstalling)}</span>
          <button onClick={() => rg.install()} data-testid="trigger">trigger</button>
        </>
      );
    }

    const user = userEvent.setup();
    render(
      <ExtensionProvider initialStatus={INITIAL_STATUS}>
        <InstallProbe />
      </ExtensionProvider>
    );
    await waitFor(() => expect(screen.getByTestId("installing").textContent).toBe("false"));

    await user.click(screen.getByTestId("trigger"));
    await waitFor(() => expect(screen.getByTestId("installing").textContent).toBe("true"));

    resolveInstall({ success: true });
    await waitFor(() => expect(screen.getByTestId("installing").textContent).toBe("false"));
  });

  it("rejects concurrent install on the same id", async () => {
    // Use a deferred promise so the first install is genuinely in-flight when
    // the second click fires. mockResolvedValue would resolve synchronously and
    // the guard would already have cleared by the time the second click runs.
    const installModule = await import("@/actions/extension-actions");
    let resolveInstall: (v: { success: boolean }) => void = () => {};
    (installModule.installExtension as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((r) => { resolveInstall = r; })
    );

    function ConcurrentProbe() {
      const rg = useExtension("rg");
      return <button onClick={() => rg.install()} data-testid="trigger">go</button>;
    }

    const user = userEvent.setup();
    render(
      <ExtensionProvider initialStatus={INITIAL_STATUS}>
        <ConcurrentProbe />
      </ExtensionProvider>
    );
    await user.click(screen.getByTestId("trigger"));
    await user.click(screen.getByTestId("trigger"));
    expect(installModule.installExtension).toHaveBeenCalledTimes(1);

    resolveInstall({ success: true });
    await waitFor(() => {
      expect(installModule.installExtension).toHaveBeenCalledTimes(1);
    });
  });
});
