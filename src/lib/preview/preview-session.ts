import { PtySession } from "@/lib/pty/pty-session";
import { ReadyWatcher } from "./ready-watcher";
import type { PreviewPreset } from "./preset-types";

export type PreviewStatus =
  | "stopped"
  | "installing"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface PreviewState {
  key: string;
  status: PreviewStatus;
  url: string | null;
  port: number;
  startedAt: number | null;
  readyAt: number | null;
  errorMessage: string | null;
  installed: boolean | null;
  activeSubscribers: number;
  subscriberTaskIds: string[];
}

export interface PreviewSessionOpts {
  key: string;
  cwd: string;
  command: string;
  args: string[];
  port: number;
  preset: PreviewPreset | null;
  envOverrides?: Record<string, string>;
}

export interface InstallOpts {
  installCommand: string;
  installArgs: string[];
  installCwd?: string;
  autoStartAfter?: boolean;
}

const BUFFER_MAX_LINES = 5000;

export class PreviewSession {
  status: PreviewStatus = "stopped";
  private pty: PtySession | null = null;
  private ringBuffer: string[] = [];
  private currentUrl: string | null = null;
  private startedAt: number | null = null;
  private readyAt: number | null = null;
  private errorMessage: string | null = null;
  private installed: boolean | null = null;
  private readyWatcher: ReadyWatcher | null = null;
  private cancelRequested = false;
  private pendingAutoStart = false;

  private outputListeners = new Map<string, (data: string) => void>();
  private stateListeners = new Map<string, (state: PreviewState) => void>();
  private subscribers = new Map<string, { taskId: string }>();
  private internalListenerSeq = 0;

  constructor(public readonly opts: PreviewSessionOpts) {}

  get key(): string {
    return this.opts.key;
  }

  get activeSubscriberCount(): number {
    return this.subscribers.size;
  }

  get subscriberTaskIds(): Set<string> {
    return new Set([...this.subscribers.values()].map((v) => v.taskId));
  }

  getBuffer(): string[] {
    return [...this.ringBuffer];
  }

  getState(): PreviewState {
    return {
      key: this.opts.key,
      status: this.status,
      url: this.currentUrl,
      port: this.opts.port,
      startedAt: this.startedAt,
      readyAt: this.readyAt,
      errorMessage: this.errorMessage,
      installed: this.installed,
      activeSubscribers: this.activeSubscriberCount,
      subscriberTaskIds: [...this.subscriberTaskIds],
    };
  }

  subscribe(
    connectionId: string,
    taskId: string,
    onState: (s: PreviewState) => void,
    onOutput: (data: string) => void
  ): () => void {
    this.subscribers.set(connectionId, { taskId });
    this.stateListeners.set(connectionId, onState);
    this.outputListeners.set(connectionId, onOutput);
    return () => {
      this.subscribers.delete(connectionId);
      this.stateListeners.delete(connectionId);
      this.outputListeners.delete(connectionId);
      this.broadcastState();
    };
  }

  async run(): Promise<{ started: boolean; error?: string }> {
    if (this.status === "installing") {
      return { started: false, error: "Install in progress" };
    }
    if (this.status === "running" || this.status === "starting") {
      return { started: true };
    }
    this.cancelRequested = false;
    this.errorMessage = null;
    this.status = "starting";
    this.startedAt = Date.now();
    this.broadcastState();

    try {
      this.pty = this.createPty(this.opts.command, this.opts.args, this.opts.cwd);
    } catch (err) {
      this.status = "error";
      this.errorMessage = `Failed to spawn: ${String(err)}`;
      this.broadcastState();
      return { started: false, error: this.errorMessage };
    }

    this.readyWatcher = new ReadyWatcher(
      this.opts.preset,
      this.opts.port,
      this.opts.preset?.startTimeoutMs ?? 60_000,
      (url) => this.handleReady(url),
      () => this.handleTimeout()
    );
    this.readyWatcher.start();
    return { started: true };
  }

  async install(opts: InstallOpts): Promise<{ ok: boolean; error?: string }> {
    if (this.status !== "stopped" && this.status !== "error") {
      return { ok: false, error: `Cannot install while ${this.status}` };
    }
    this.cancelRequested = false;
    this.errorMessage = null;
    this.status = "installing";
    this.pendingAutoStart = opts.autoStartAfter ?? false;
    this.broadcastState();

    try {
      this.pty = this.createPty(
        opts.installCommand,
        opts.installArgs,
        opts.installCwd ?? this.opts.cwd
      );
    } catch (err) {
      this.status = "error";
      this.errorMessage = `Failed to spawn install: ${String(err)}`;
      this.broadcastState();
      return { ok: false, error: this.errorMessage };
    }
    return { ok: true };
  }

  stop(): void {
    if (
      this.status === "installing" ||
      this.status === "starting" ||
      this.status === "running"
    ) {
      this.cancelRequested = true;
    }
    if (this.readyWatcher) {
      this.readyWatcher.stop();
      this.readyWatcher = null;
    }

    // No live pty (already exited) — short-circuit to stopped
    if (!this.pty || this.pty.killed) {
      this.injectLog("Stopped.");
      this.status = "stopped";
      this.pendingAutoStart = false;
      this.broadcastState();
      return;
    }

    // Graceful shutdown: SIGTERM the whole process GROUP, then escalate to a
    // group SIGKILL after the grace period (handled inside killTree). Dev
    // servers (vite/webpack/next) spawn worker children that share the leader's
    // process group — killing only the leader orphans those workers as residual
    // node processes, so we must reap the group.
    this.injectLog("Stopping (SIGTERM)...");
    this.status = "stopping";
    this.broadcastState();
    try {
      this.pty.killTree();
    } catch {
      // best-effort
    }
  }

  /**
   * Push a synthetic log line to both the ring buffer (for state.recentLogs)
   * and live output listeners (xterm drawer). Surfaces preview lifecycle
   * events that didn't come from the child process itself.
   */
  private injectLog(message: string): void {
    const line = `[preview] ${message}`;
    this.pushBuffer(line);
    const data = `\r\n${line}\r\n`;
    for (const fn of this.outputListeners.values()) {
      try {
        fn(data);
      } catch {
        // ignore
      }
    }
  }

  // Test helper
  pushBuffer(line: string): void {
    this.ringBuffer.push(line);
    if (this.ringBuffer.length > BUFFER_MAX_LINES) {
      this.ringBuffer.splice(0, this.ringBuffer.length - BUFFER_MAX_LINES);
    }
  }

  private createPty(command: string, args: string[], cwd: string): PtySession {
    const pty = new PtySession(
      this.opts.key,
      command,
      args,
      cwd,
      (data) => this.handlePtyData(data),
      (exitCode) => this.handlePtyExit(exitCode),
      this.opts.envOverrides,
      undefined, // onIdle disabled — dev server may be silent for long periods
      undefined
    );
    try {
      pty.resize(200, 50);
    } catch {
      // best-effort
    }
    return pty;
  }

  private handlePtyData(data: string): void {
    const lines = data.split(/\r?\n/);
    for (const line of lines) {
      if (line.length === 0) continue;
      this.pushBuffer(line);
      if (this.readyWatcher) this.readyWatcher.feedLine(line);
    }
    for (const fn of this.outputListeners.values()) {
      try {
        fn(data);
      } catch {
        // ignore listener errors
      }
    }
  }

  private handlePtyExit(exitCode: number): void {
    const wasCancel = this.cancelRequested;
    const wasInstalling = this.status === "installing";
    this.pty = null;
    if (this.readyWatcher) {
      this.readyWatcher.stop();
      this.readyWatcher = null;
    }
    if (wasCancel) {
      this.injectLog(`Stopped (exit code ${exitCode}).`);
      this.status = "stopped";
      this.pendingAutoStart = false;
    } else if (exitCode === 0 && wasInstalling) {
      this.installed = true;
      this.status = "stopped"; // must transition before scheduling run(), otherwise run() guard bails on "installing"
      if (this.pendingAutoStart) {
        this.pendingAutoStart = false;
        // Use setTimeout to avoid re-entrant state mutation
        setTimeout(() => void this.run(), 0);
      }
    } else if (exitCode !== 0) {
      this.injectLog(`Exited with code ${exitCode}.`);
      this.status = "error";
      this.errorMessage = `Process exited with code ${exitCode}`;
      this.pendingAutoStart = false;
    } else {
      this.injectLog("Exited.");
      this.status = "stopped";
    }
    this.broadcastState();
  }

  private handleReady(url: string | null): void {
    this.currentUrl = url ?? `http://localhost:${this.opts.port}/`;
    this.status = "running";
    this.readyAt = Date.now();
    this.broadcastState();
  }

  private handleTimeout(): void {
    this.status = "error";
    this.errorMessage = `Start timeout (${this.opts.preset?.startTimeoutMs ?? 60_000}ms). See logs.`;
    if (this.readyWatcher) {
      this.readyWatcher.stop();
      this.readyWatcher = null;
    }
    this.broadcastState();
  }

  /**
   * Register an internal state observer (used by tests and embedders). Keyed by
   * a monotonic counter — deterministic and HMR/GC-friendly, unlike a random key.
   */
  onStateChange(fn: (s: PreviewState) => void): void {
    this.stateListeners.set(`__internal-${this.internalListenerSeq++}`, fn);
  }

  private broadcastState(): void {
    const state = this.getState();
    for (const fn of this.stateListeners.values()) {
      try {
        fn(state);
      } catch {
        // ignore
      }
    }
  }
}
