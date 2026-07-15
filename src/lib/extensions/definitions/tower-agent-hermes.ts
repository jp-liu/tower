import { Bot } from "lucide-react";
import {
  checkTowerAgentExtension,
  installTowerAgentExtension,
  uninstallTowerAgentExtension,
} from "../tower-agent-install";
import type { Extension, ExtensionResult, ExtensionStatus } from "../types";

async function check(): Promise<ExtensionStatus> {
  return checkTowerAgentExtension("hermes");
}

async function install(): Promise<ExtensionResult> {
  return installTowerAgentExtension({ gateway: "hermes" });
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
