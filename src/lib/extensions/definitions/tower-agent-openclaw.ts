import { RadioTower } from "lucide-react";
import {
  checkTowerAgentExtension,
  installTowerAgentExtension,
  uninstallTowerAgentExtension,
} from "../tower-agent-install";
import type { Extension, ExtensionResult, ExtensionStatus } from "../types";

async function check(): Promise<ExtensionStatus> {
  return checkTowerAgentExtension("openclaw");
}

async function install(): Promise<ExtensionResult> {
  return installTowerAgentExtension({ gateway: "openclaw" });
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
