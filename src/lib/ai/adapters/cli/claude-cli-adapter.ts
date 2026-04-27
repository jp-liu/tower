import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveCommandPathSync } from "@/lib/platform";
import type { CliAdapter, CliSpawnOptions, CliSpawnResult } from "../../types";

const CLAUDE_MODELS = ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

export class ClaudeCliAdapter implements CliAdapter {

  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult {
    const args: string[] = [];

    if (opts.profileArgs?.length) {
      args.push(...opts.profileArgs);
    }

    if (opts.resumeSessionId) {
      args.push("--resume", opts.resumeSessionId);
    } else if (opts.continueLatest) {
      args.push("--continue");
    } else {
      if (opts.prompt) {
        args.push(opts.prompt);
      }
    }

    const env: Record<string, string> = {
      ...(opts.profileEnvVars ?? {}),
      ...(opts.envOverrides ?? {}),
    };

    return {
      command: this.resolveCommand(),
      args,
      env,
    };
  }

  buildEnvOverrides(opts: {
    taskId: string;
    taskTitle: string;
    apiUrl: string;
    callbackUrl?: string;
  }): Record<string, string> {
    const env: Record<string, string> = {
      TOWER_TASK_ID: opts.taskId,
      TOWER_TASK_TITLE: opts.taskTitle,
      TOWER_STARTED_AT: new Date().toISOString(),
      TOWER_API_URL: opts.apiUrl,
    };
    if (opts.callbackUrl) {
      env.CALLBACK_URL = opts.callbackUrl;
    }
    return env;
  }

  async installHooks(_apiUrl: string): Promise<void> {
    const settings = this.readSettings();
    const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
    const entries = this.getPostToolUseArray(settings);

    if (this.findTowerHookIndex(entries) >= 0) return;

    const hookPath = path.join(process.cwd(), "scripts", "post-tool-hook.js");
    const newEntry = {
      hooks: [{ command: `node "${hookPath}"`, timeout: 10, type: "command" }],
      matcher: "Write|Edit|MultiEdit",
    };

    settings["hooks"] = { ...hooks, PostToolUse: [...entries, newEntry] };
    this.writeSettings(settings);
  }

  async uninstallHooks(): Promise<void> {
    const settings = this.readSettings();
    const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
    const entries = this.getPostToolUseArray(settings);
    const filtered = entries.filter(
      (e) => !e.hooks?.some((h: { command?: string }) => h.command?.includes("post-tool-hook.js"))
    );
    settings["hooks"] = { ...hooks, PostToolUse: filtered };
    this.writeSettings(settings);
  }

  async isHooksInstalled(): Promise<boolean> {
    const settings = this.readSettings();
    const entries = this.getPostToolUseArray(settings);
    return this.findTowerHookIndex(entries) >= 0;
  }

  async isAvailable(): Promise<boolean> {
    const version = await this.getVersion();
    return version !== null;
  }

  async getVersion(): Promise<string | null> {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const cmd = this.resolveCommand();
      const { stdout } = await execFileAsync(cmd, ["--version"], { timeout: 5000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async getModels(): Promise<string[]> {
    return CLAUDE_MODELS;
  }

  getConfigDir(): string {
    return path.join(os.homedir(), ".claude");
  }

  getSettingsPath(): string {
    return path.join(this.getConfigDir(), "settings.json");
  }

  getSessionsDir(): string {
    return path.join(this.getConfigDir(), "projects");
  }

  /** Resolve claude binary — env var > platform-aware resolution.
   *  Public so claude-session.ts can reuse instead of duplicating findClaudeBinary(). */
  resolveCommand(): string {
    if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;
    if (process.platform === "win32") {
      const native = resolveCommandPathSync("claude-code");
      if (native !== "claude-code") return native;
    }
    return resolveCommandPathSync("claude");
  }

  private readSettings(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.getSettingsPath(), "utf-8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private writeSettings(data: Record<string, unknown>): void {
    const dir = this.getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.getSettingsPath(), JSON.stringify(data, null, 2), "utf-8");
  }

  private getPostToolUseArray(settings: Record<string, unknown>): Array<{
    hooks: Array<{ command: string; timeout: number; type: string }>;
    matcher: string;
  }> {
    const hooks = settings["hooks"] as Record<string, unknown> | undefined;
    if (!hooks) return [];
    const arr = hooks["PostToolUse"];
    return Array.isArray(arr) ? arr : [];
  }

  private findTowerHookIndex(entries: Array<{ hooks: Array<{ command?: string }> }>): number {
    return entries.findIndex((e) =>
      e.hooks?.some((h) => h.command?.includes("post-tool-hook.js"))
    );
  }
}
