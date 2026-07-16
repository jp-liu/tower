import { Bot } from "lucide-react";
import {
  checkTowerAgentExtension,
  installTowerAgentExtension,
  uninstallTowerAgentExtension,
} from "../tower-agent-install";
import { readHarnessGatewayRuntimeConfig } from "@/lib/harness/gateway-config";
import type { Extension, ExtensionResult, ExtensionStatus } from "../types";

async function check(): Promise<ExtensionStatus> {
  const config = await readHarnessGatewayRuntimeConfig("hermes");
  return checkTowerAgentExtension("hermes", { profile: config.profile });
}

async function install(): Promise<ExtensionResult> {
  const config = await readHarnessGatewayRuntimeConfig("hermes");
  return installTowerAgentExtension({ gateway: "hermes", ...config });
}

async function uninstall(): Promise<ExtensionResult> {
  return uninstallTowerAgentExtension("hermes");
}

export const towerAgentHermesExtension: Extension = {
  id: "tower-agent-hermes",
  name: "Tower Agent (Hermes)",
  description: "安装 Tower 助手 profile、MCP 与 skills 到 Hermes",
  icon: Bot,
  sizeMB: 1,
  homepageUrl: "https://hermes-agent.nousresearch.com/docs/",
  check,
  install,
  uninstall,
};
