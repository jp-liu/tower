import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveCommandPathSync } from "@/lib/platform";
import type { CliAdapter, CliSpawnOptions, CliSpawnResult, McpServerConfig } from "../../types";

const CODEX_MODELS = ["o4-mini", "o3", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "codex-mini-latest"];

export class CodexCliAdapter implements CliAdapter {

  buildSpawnArgs(opts: CliSpawnOptions): CliSpawnResult {
    // Codex uses subcommands: `codex resume <id>` / `codex resume --last`
    // Fresh start: `codex --full-auto [extraArgs] "prompt"`
    const args: string[] = [];

    if (opts.resumeSessionId) {
      // `codex resume <sessionId>`
      args.push("resume", opts.resumeSessionId);
    } else if (opts.continueLatest) {
      // `codex resume --last`
      args.push("resume", "--last");
    } else {
      // Fresh start: `codex --full-auto [extraArgs] "prompt"`
      args.push("--full-auto");

      if (opts.extraArgs?.length) {
        args.push(...opts.extraArgs);
      }

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
    const hooks = this.readHooks();
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

    // Stop hook — notifies Tower when agent finishes
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
      this.writeHooks(hooks);
      this.ensureHooksFeatureEnabled();
    }
  }

  async uninstallHooks(): Promise<void> {
    const hooks = this.readHooks();
    const hookFiles = ["session-start-hook.js", "post-tool-hook.js", "stop-hook.js"];

    for (const event of ["SessionStart", "PostToolUse", "Stop"]) {
      const entries = this.getHookArray(hooks, event);
      hooks[event] = entries.filter(
        (e) => !e.hooks?.some((h: { command?: string }) =>
          hookFiles.some((f) => h.command?.includes(f))
        )
      );
    }

    this.writeHooks(hooks);
  }

  async isHooksInstalled(): Promise<boolean> {
    const hooks = this.readHooks();
    const entries = this.getHookArray(hooks, "PostToolUse");
    return this.hasHook(entries, "post-tool-hook.js");
  }

  async installMcp(server: McpServerConfig): Promise<void> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const cmd = this.resolveCommand();

    // Build args: codex mcp add <name> [--env K=V ...] -- <command> <args...>
    const args = ["mcp", "add", server.name];
    if (server.env) {
      for (const [k, v] of Object.entries(server.env)) {
        args.push("--env", `${k}=${v}`);
      }
    }
    args.push("--", server.command, ...server.args);

    await execFileAsync(cmd, args, { timeout: 10000 });
  }

  async uninstallMcp(name: string): Promise<void> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const cmd = this.resolveCommand();

    await execFileAsync(cmd, ["mcp", "remove", name], { timeout: 10000 });
  }

  async isMcpInstalled(name: string): Promise<boolean> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const cmd = this.resolveCommand();

    try {
      await execFileAsync(cmd, ["mcp", "get", name], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
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
    return CODEX_MODELS;
  }

  getConfigDir(): string {
    return path.join(os.homedir(), ".codex");
  }

  getSettingsPath(): string {
    return path.join(this.getConfigDir(), "config.toml");
  }

  getSessionsDir(): string {
    return path.join(this.getConfigDir(), "sessions");
  }

  getApiKeyInfo(): { envVar: string; required: boolean } {
    return { envVar: "OPENAI_API_KEY", required: false };
  }

  buildHelloProbeArgs(): { command: string; args: string[] } {
    return {
      command: this.resolveCommand(),
      args: ["exec", "-"],
    };
  }

  /** Resolve codex binary — env var > platform-aware resolution. */
  resolveCommand(): string {
    if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
    return resolveCommandPathSync("codex");
  }

  // -- hooks.json helpers ---------------------------------------------------

  private getHooksPath(): string {
    return path.join(this.getConfigDir(), "hooks.json");
  }

  private readHooks(): Record<string, unknown> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.getHooksPath(), "utf-8")) as Record<string, unknown>;
      return (raw["hooks"] as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }

  private writeHooks(hooks: Record<string, unknown>): void {
    const dir = this.getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.getHooksPath(), JSON.stringify({ hooks }, null, 2), "utf-8");
  }

  /** Ensure `[features] codex_hooks = true` in config.toml so hooks actually fire. */
  private ensureHooksFeatureEnabled(): void {
    const tomlPath = this.getSettingsPath();
    let content = "";
    try { content = fs.readFileSync(tomlPath, "utf-8"); } catch { /* file may not exist */ }

    if (/codex_hooks\s*=\s*true/.test(content)) return;

    // Append or update the feature flag
    if (/\[features\]/.test(content)) {
      // Section exists — append under it
      content = content.replace(/\[features\]/, "[features]\ncodex_hooks = true");
    } else {
      content += "\n[features]\ncodex_hooks = true\n";
    }

    const dir = this.getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tomlPath, content, "utf-8");
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
