import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveCommandPathSync } from "@/lib/platform";
import type { CliAdapter, CliSpawnOptions, CliSpawnResult, McpServerConfig } from "../../types";

const CLAUDE_MODELS = ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"];

export class ClaudeCliAdapter implements CliAdapter {

  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult {
    const args: string[] = [
      "--dangerously-skip-permissions",
    ];

    if (opts.extraArgs?.length) {
      args.push(...opts.extraArgs);
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
    const root = process.cwd().replace(/\\/g, "/");
    let changed = false;

    // SessionStart hook — reports sessionId
    const sessionStartEntries = this.getHookArray(hooks, "SessionStart");
    if (!this.hasHook(sessionStartEntries, "session-start-hook.js")) {
      const hookPath = path.join(root, "scripts", "session-start-hook.js").replace(/\\/g, "/");
      sessionStartEntries.push({
        hooks: [{ command: `node "${hookPath}"`, timeout: 5, type: "command" }],
      });
      hooks["SessionStart"] = sessionStartEntries;
      changed = true;
    }

    // PostToolUse hook — auto-uploads files
    const postToolEntries = this.getHookArray(hooks, "PostToolUse");
    if (!this.hasHook(postToolEntries, "post-tool-hook.js")) {
      const hookPath = path.join(root, "scripts", "post-tool-hook.js").replace(/\\/g, "/");
      postToolEntries.push({
        hooks: [{ command: `node "${hookPath}"`, timeout: 10, type: "command" }],
        matcher: "Write|Edit|MultiEdit",
      });
      hooks["PostToolUse"] = postToolEntries;
      changed = true;
    }

    // Stop hook — notifies Tower when Claude finishes responding
    const stopEntries = this.getHookArray(hooks, "Stop");
    if (!this.hasHook(stopEntries, "stop-hook.js")) {
      const hookPath = path.join(root, "scripts", "stop-hook.js").replace(/\\/g, "/");
      stopEntries.push({
        hooks: [{ command: `node "${hookPath}"`, timeout: 5, type: "command" }],
      });
      hooks["Stop"] = stopEntries;
      changed = true;
    }

    if (changed) {
      settings["hooks"] = hooks;
      this.writeSettings(settings);
    }
  }

  async uninstallHooks(): Promise<void> {
    const settings = this.readSettings();
    const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
    const hookFiles = ["session-start-hook.js", "post-tool-hook.js", "stop-hook.js"];

    for (const event of ["SessionStart", "PostToolUse", "Stop"]) {
      const entries = this.getHookArray(hooks, event);
      hooks[event] = entries.filter(
        (e) => !e.hooks?.some((h: { command?: string }) =>
          hookFiles.some((f) => h.command?.includes(f))
        )
      );
    }

    settings["hooks"] = hooks;
    this.writeSettings(settings);
  }

  async isHooksInstalled(): Promise<boolean> {
    const settings = this.readSettings();
    const hooks = (settings["hooks"] as Record<string, unknown>) ?? {};
    // Consider installed if the PostToolUse hook exists (primary hook)
    const entries = this.getHookArray(hooks, "PostToolUse");
    return this.hasHook(entries, "post-tool-hook.js");
  }

  async installMcp(server: McpServerConfig): Promise<void> {
    const settings = this.readSettings();
    const mcpServers = (settings["mcpServers"] as Record<string, unknown>) ?? {};

    const entry: Record<string, unknown> = {
      command: server.command,
      args: server.args,
    };
    if (server.env && Object.keys(server.env).length > 0) {
      entry.env = server.env;
    }

    mcpServers[server.name] = entry;
    settings["mcpServers"] = mcpServers;
    this.writeSettings(settings);
  }

  async uninstallMcp(name: string): Promise<void> {
    const settings = this.readSettings();
    const mcpServers = (settings["mcpServers"] as Record<string, unknown>) ?? {};
    delete mcpServers[name];
    settings["mcpServers"] = mcpServers;
    this.writeSettings(settings);
  }

  async isMcpInstalled(name: string): Promise<boolean> {
    const settings = this.readSettings();
    const mcpServers = (settings["mcpServers"] as Record<string, unknown>) ?? {};
    return name in mcpServers;
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

  getApiKeyInfo(): { envVar: string; required: boolean } {
    return { envVar: "ANTHROPIC_API_KEY", required: false };
  }

  buildHelloProbeArgs(): { command: string; args: string[] } {
    return {
      command: this.resolveCommand(),
      args: ["--print", "-", "--output-format", "stream-json", "--verbose"],
    };
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getHookArray(hooks: Record<string, unknown>, event: string): any[] {
    const arr = hooks[event];
    return Array.isArray(arr) ? arr : [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hasHook(entries: any[], filename: string): boolean {
    return entries.some(
      (e) => e.hooks?.some((h: { command?: string }) => h.command?.includes(filename))
    );
  }
}
