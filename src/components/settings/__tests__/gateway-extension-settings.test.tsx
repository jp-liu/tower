import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/lib/i18n";
import { listExtensionMetadata } from "@/lib/extensions/metadata";
import {
  isGatewayAdapterExtension,
  type GatewayAdapterExtensionMetadata,
  type GatewaySettingsCapability,
} from "@/lib/extensions/types";
import {
  GatewayExtensionSettings,
  invalidateGatewaySettingsCache,
} from "../gateway-extension-settings";

const actionMocks = vi.hoisted(() => ({
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
  checkExtension: vi.fn(),
  getGatewayChannelAccessList: vi.fn(),
}));

vi.mock("@/actions/config-actions", () => ({
  getConfigValue: actionMocks.getConfigValue,
  setConfigValue: actionMocks.setConfigValue,
}));
vi.mock("@/actions/extension-actions", () => ({
  checkExtension: actionMocks.checkExtension,
}));
vi.mock("@/actions/gateway-channel-access-actions", () => ({
  getGatewayChannelAccessList: actionMocks.getGatewayChannelAccessList,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const GATEWAY_EXTENSIONS = listExtensionMetadata().filter(isGatewayAdapterExtension);

function renderSection(
  extensions: readonly GatewayAdapterExtensionMetadata[] = GATEWAY_EXTENSIONS,
) {
  return render(
    <I18nProvider>
      <GatewayExtensionSettings extensions={extensions} />
    </I18nProvider>,
  );
}

describe("GatewayExtensionSettings cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateGatewaySettingsCache();
    actionMocks.getConfigValue.mockResolvedValue({});
    actionMocks.setConfigValue.mockResolvedValue(undefined);
    actionMocks.checkExtension.mockResolvedValue({ installed: true, version: "2" });
    actionMocks.getGatewayChannelAccessList.mockResolvedValue([]);
  });

  it("reuses configuration and status when the section remounts", async () => {
    const first = renderSection();
    await screen.findAllByText(/已安装 v2|Installed v2/i);
    expect(actionMocks.getConfigValue).toHaveBeenCalledTimes(2);
    expect(actionMocks.checkExtension).toHaveBeenCalledTimes(2);
    expect(actionMocks.getGatewayChannelAccessList).toHaveBeenCalledTimes(1);
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

  it("shows an empty channel state when the adapter supports channel access", async () => {
    renderSection();
    expect(await screen.findByText(/暂无已授权或已撤销的群|No authorized or revoked channels/i)).toBeInTheDocument();
    expect(screen.getAllByText(/群授权|Channel access/i)).toHaveLength(1);
  });

  it("hides channel access when the adapter does not declare that capability", async () => {
    const extensions = GATEWAY_EXTENSIONS.map((extension) => ({
      ...extension,
      capabilities: extension.capabilities.filter(
        (capability): capability is Exclude<GatewaySettingsCapability, "gateway.channel-access"> =>
          capability !== "gateway.channel-access",
      ),
    }));

    renderSection(extensions);
    await screen.findAllByText(/已安装 v2|Installed v2/i);
    expect(screen.queryByText(/群授权|Channel access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/暂无已授权或已撤销的群|No authorized or revoked channels/i)).not.toBeInTheDocument();
  });
});
