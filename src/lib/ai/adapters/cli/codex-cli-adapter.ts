import * as os from "node:os";
import * as path from "node:path";
import { resolveCommandPathSync } from "@/lib/platform";
import type { CliAdapter, CliSpawnOptions, CliSpawnResult } from "../../types";

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
    // Codex uses TOML config at ~/.codex/config.toml
    // Hook installation for Codex is a no-op for now — Codex hook system
    // differs from Claude's JSON-based hooks and needs further investigation.
  }

  async uninstallHooks(): Promise<void> {
    // No-op — see installHooks comment
  }

  async isHooksInstalled(): Promise<boolean> {
    // No hooks installed for Codex yet
    return false;
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
}
