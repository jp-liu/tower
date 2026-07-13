import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveCommandPathSync } from "@/lib/platform";
import type {
  CliAdapter,
  CliSpawnOptions,
  CliSpawnResult,
  InstallResult,
  McpInstallOptions,
  McpServerConfig,
} from "../../types";

const DEFAULT_PROFILE = process.env.HERMES_PROFILE || "h-tower";

export class HermesCliAdapter implements CliAdapter {
  constructor(private readonly profile = DEFAULT_PROFILE) {}

  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult {
    void opts;
    throw new Error("Hermes is a message gateway adapter, not a Tower task terminal provider.");
  }

  buildEnvOverrides(): Record<string, string> {
    return {};
  }

  async installHooks(apiUrl: string): Promise<InstallResult> {
    void apiUrl;
    return { ok: true, method: "file", detail: "Hermes gateway does not use Tower PTY hooks" };
  }

  async uninstallHooks(): Promise<InstallResult> {
    return { ok: true, method: "file", detail: "Hermes gateway does not use Tower PTY hooks" };
  }

  async isHooksInstalled(): Promise<boolean> {
    return true;
  }

  async installMcp(server: McpServerConfig, opts: McpInstallOptions = {}): Promise<InstallResult> {
    void opts;
    const configPath = this.getSettingsPath();
    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
      const next = upsertHermesMcpServer(current, server);
      fs.writeFileSync(configPath, next, "utf-8");
      return { ok: true, method: "file", detail: configPath };
    } catch (err) {
      return {
        ok: false,
        method: "file",
        detail: configPath,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async uninstallMcp(name: string): Promise<InstallResult> {
    const configPath = this.getSettingsPath();
    try {
      if (!fs.existsSync(configPath)) return { ok: true, method: "file", detail: configPath };
      const current = fs.readFileSync(configPath, "utf-8");
      fs.writeFileSync(configPath, removeYamlBlock(current, ["mcp_servers", name]), "utf-8");
      return { ok: true, method: "file", detail: configPath };
    } catch (err) {
      return {
        ok: false,
        method: "file",
        detail: configPath,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async isMcpInstalled(name: string): Promise<boolean> {
    try {
      const current = fs.readFileSync(this.getSettingsPath(), "utf-8");
      return new RegExp(`^  ${escapeRegExp(name)}:\\s*$`, "m").test(current);
    } catch {
      return false;
    }
  }

  async installSkill(skillName: string, sourceDir: string): Promise<InstallResult> {
    const target = path.join(this.getConfigDir(), "skills", skillName);
    try {
      if (!fs.existsSync(sourceDir)) {
        return { ok: false, method: "symlink", detail: target, error: `Source skill dir does not exist: ${sourceDir}` };
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const existing = await fs.promises.lstat(target).catch(() => null);
      if (existing) {
        if (!existing.isSymbolicLink()) {
          return { ok: false, method: "symlink", detail: target, error: `Refusing to overwrite non-symlink at ${target}` };
        }
        const current = await fs.promises.readlink(target);
        const resolved = path.isAbsolute(current) ? current : path.resolve(path.dirname(target), current);
        if (path.resolve(resolved) === path.resolve(sourceDir)) {
          return { ok: true, method: "symlink", detail: `${target} -> ${sourceDir} (already)` };
        }
        await fs.promises.unlink(target);
      }
      await fs.promises.symlink(sourceDir, target, "dir");
      return { ok: true, method: "symlink", detail: `${target} -> ${sourceDir}` };
    } catch (err) {
      return {
        ok: false,
        method: "symlink",
        detail: target,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async uninstallSkill(skillName: string): Promise<InstallResult> {
    const target = path.join(this.getConfigDir(), "skills", skillName);
    try {
      const stat = await fs.promises.lstat(target).catch(() => null);
      if (!stat) return { ok: true, method: "symlink", detail: `${target} (already absent)` };
      if (!stat.isSymbolicLink()) {
        return { ok: false, method: "symlink", detail: target, error: `Refusing to remove non-symlink at ${target}` };
      }
      await fs.promises.unlink(target);
      return { ok: true, method: "symlink", detail: target };
    } catch (err) {
      return {
        ok: false,
        method: "symlink",
        detail: target,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async isSkillInstalled(skillName: string, expectedSourceDir?: string): Promise<boolean> {
    const target = path.join(this.getConfigDir(), "skills", skillName);
    try {
      const stat = await fs.promises.lstat(target);
      if (!stat.isSymbolicLink()) return false;
      if (!expectedSourceDir) return true;
      const current = await fs.promises.readlink(target);
      const resolved = path.isAbsolute(current) ? current : path.resolve(path.dirname(target), current);
      return path.resolve(resolved) === path.resolve(expectedSourceDir);
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.getVersion().then(Boolean);
  }

  async getVersion(): Promise<string | null> {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(this.resolveCommand(), ["--version"], { timeout: 5000 });
      return stdout.trim() || "available";
    } catch {
      return fs.existsSync(this.resolveCommand()) ? "available" : null;
    }
  }

  async getModels(): Promise<string[]> {
    return [];
  }

  getConfigDir(): string {
    return path.join(os.homedir(), ".hermes", "profiles", this.profile);
  }

  getSettingsPath(): string {
    return path.join(this.getConfigDir(), "config.yaml");
  }

  getSessionsDir(): string {
    return path.join(this.getConfigDir(), "sessions");
  }

  getApiKeyInfo(): { envVar: string; required: boolean } {
    return { envVar: "HERMES_PROFILE", required: false };
  }

  buildHelloProbeArgs(prompt: string): { command: string; args: string[] } {
    return { command: this.resolveCommand(), args: ["--profile", this.profile, prompt] };
  }

  resolveCommand(): string {
    if (process.env.HERMES_CLI_PATH) return process.env.HERMES_CLI_PATH;
    try {
      return resolveCommandPathSync("hermes");
    } catch {
      return path.join(os.homedir(), ".local", "bin", "hermes");
    }
  }
}

function upsertHermesMcpServer(content: string, server: McpServerConfig): string {
  let next = content.trimEnd();
  if (!/^mcp_servers:\s*$/m.test(next)) {
    next += `${next ? "\n" : ""}mcp_servers:\n`;
  }
  next = removeYamlBlock(next, ["mcp_servers", server.name]).trimEnd();
  const lines = [
    `  ${server.name}:`,
    `    command: ${yamlString(server.command)}`,
    "    args:",
    ...server.args.map((arg) => `      - ${yamlString(arg)}`),
  ];
  if (server.env && Object.keys(server.env).length > 0) {
    lines.push("    env:");
    for (const [key, value] of Object.entries(server.env)) {
      lines.push(`      ${key}: ${yamlString(value)}`);
    }
  }
  return next.replace(/^mcp_servers:\s*$/m, (m) => `${m}\n${lines.join("\n")}`) + "\n";
}

function removeYamlBlock(content: string, pathParts: [string, string]): string {
  const lines = content.split(/\r?\n/);
  const parentIndex = lines.findIndex((line) => line.trim() === `${pathParts[0]}:`);
  if (parentIndex < 0) return content;
  const childIndex = lines.findIndex((line, index) => index > parentIndex && line === `  ${pathParts[1]}:`);
  if (childIndex < 0) return content;
  let end = childIndex + 1;
  while (end < lines.length && (lines[end].startsWith("    ") || lines[end].trim() === "")) end++;
  lines.splice(childIndex, end - childIndex);
  return lines.join("\n");
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
