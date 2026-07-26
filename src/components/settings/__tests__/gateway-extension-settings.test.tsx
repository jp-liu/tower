import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import {
  GatewayExtensionSettings,
  invalidateGatewaySettingsCache,
} from "../gateway-extension-settings";

const actionMocks = vi.hoisted(() => ({
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
  checkExtension: vi.fn(),
}));

vi.mock("@/actions/config-actions", () => ({
  getConfigValue: actionMocks.getConfigValue,
  setConfigValue: actionMocks.setConfigValue,
}));
vi.mock("@/actions/extension-actions", () => ({
  checkExtension: actionMocks.checkExtension,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderSection() {
  return render(<I18nProvider><GatewayExtensionSettings /></I18nProvider>);
}

describe("GatewayExtensionSettings cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateGatewaySettingsCache();
    actionMocks.getConfigValue.mockResolvedValue({});
    actionMocks.setConfigValue.mockResolvedValue(undefined);
    actionMocks.checkExtension.mockResolvedValue({ installed: true, version: "2" });
  });

  it("reuses configuration and status when the section remounts", async () => {
    const first = renderSection();
    await screen.findAllByText(/已安装 v2|Installed v2/i);
    expect(actionMocks.getConfigValue).toHaveBeenCalledTimes(2);
    expect(actionMocks.checkExtension).toHaveBeenCalledTimes(2);
    first.unmount();

    renderSection();
    expect(await screen.findAllByText(/已安装 v2|Installed v2/i)).toHaveLength(2);
    expect(actionMocks.getConfigValue).toHaveBeenCalledTimes(2);
    expect(actionMocks.checkExtension).toHaveBeenCalledTimes(2);
  });

  it("checks one gateway again only when its refresh button is used", async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findAllByText(/已安装 v2|Installed v2/i);

    await user.click(screen.getAllByRole("button", { name: /重新检测|Recheck/i })[0]);
    await waitFor(() => expect(actionMocks.checkExtension).toHaveBeenCalledTimes(3));
  });
});
