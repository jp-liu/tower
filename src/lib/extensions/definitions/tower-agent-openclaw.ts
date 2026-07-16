import { RadioTower } from "lucide-react";
import {
  checkTowerAgentExtension,
  installTowerAgentExtension,
  uninstallTowerAgentExtension,
} from "../tower-agent-install";
import { readHarnessGatewayRuntimeConfig } from "@/lib/harness/gateway-config";
import type { Extension, ExtensionResult, ExtensionStatus } from "../types";

async function check(): Promise<ExtensionStatus> {
  const config = await readHarnessGatewayRuntimeConfig("openclaw");
  return checkTowerAgentExtension("openclaw", { profile: config.profile });
}

async function install(): Promise<ExtensionResult> {
  const config = await readHarnessGatewayRuntimeConfig("openclaw");
  return installTowerAgentExtension({ gateway: "openclaw", ...config });
}

async function uninstall(): Promise<ExtensionResult> {
  return uninstallTowerAgentExtension("openclaw");
}

export const towerAgentOpenClawExtension: Extension = {
  id: "tower-agent-openclaw",
  name: "Tower Agent (OpenClaw)",
  description: "安装 Tower 助手 profile、MCP 与 skills 到 OpenClaw",
  icon: RadioTower,
  sizeMB: 1,
  homepageUrl: "https://docs.openclaw.ai/",
  check,
  install,
  uninstall,
};
