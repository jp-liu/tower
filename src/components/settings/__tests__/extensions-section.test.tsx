import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExtensionsSection } from "../extensions-section";
import { ExtensionProvider } from "@/lib/extensions/context";
import { I18nProvider } from "@/lib/i18n";

vi.mock("@/actions/extension-actions", () => ({
  listAllExtensionStatus: vi.fn().mockResolvedValue({
    rg: { installed: true, version: "14.1.1", path: "/usr/bin/rg" },
    monaco: { installed: false },
  }),
  checkExtension: vi.fn().mockResolvedValue({ installed: true }),
  installExtension: vi.fn().mockResolvedValue({ success: true }),
  uninstallExtension: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ExtensionProvider takes server-injected initialStatus — it does not fetch on
// mount. Mirror the status the layout's RSC would compute.
const INITIAL_STATUS = {
  rg: { installed: true, version: "14.1.1", path: "/usr/bin/rg" },
  monaco: { installed: false },
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <ExtensionProvider initialStatus={INITIAL_STATUS}>{children}</ExtensionProvider>
    </I18nProvider>
  );
}

describe("ExtensionsSection", () => {
  it("renders one card per registered extension", async () => {
    render(
      <Wrapper>
        <ExtensionsSection />
      </Wrapper>
    );
    await waitFor(() => {
      // Use getAllByText since "代码搜索" appears in both h3 and the description text
      expect(screen.getAllByText(/代码搜索/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/代码编辑器/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows installed status with version for rg", async () => {
    render(
      <Wrapper>
        <ExtensionsSection />
      </Wrapper>
    );
    await waitFor(() => {
      expect(screen.getByText(/v14\.1\.1/)).toBeInTheDocument();
    });
  });

  it("shows not-installed marker for monaco", async () => {
    render(
      <Wrapper>
        <ExtensionsSection />
      </Wrapper>
    );
    await waitFor(() => {
      // The mock has rg installed (true) and monaco not installed (false).
      // Verify "未安装" appears at least once (in monaco's card).
      const nodes = screen.queryAllByText(/未安装|Not installed/i);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("install button calls installExtension and shows success toast", async () => {
    const { toast } = await import("sonner");
    const actions = await import("@/actions/extension-actions");
    const user = userEvent.setup();

    render(
      <Wrapper>
        <ExtensionsSection />
      </Wrapper>
    );
    await waitFor(() => {
      const nodes = screen.getAllByText(/代码编辑器/);
      expect(nodes.length).toBeGreaterThanOrEqual(1);
    });

    // Find the "安装" button for monaco (the only one not yet installed).
    // The exact label is "安装" (Chinese) — see settings.extensions.install i18n key.
    const installButtons = screen.getAllByRole("button", { name: /^安装$|^Install$/ });
    expect(installButtons.length).toBeGreaterThanOrEqual(1);
    await user.click(installButtons[0]);

    await waitFor(() => {
      expect(actions.installExtension).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalled();
    });
  });
});
