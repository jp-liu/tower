import * as pty from "node-pty";
import { ensurePathInEnv, stripClaudeNestingEnv } from "@/lib/platform";

export class PtySession {
  readonly taskId: string;
  private readonly _pty: pty.IPty;
  killed = false;
  disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ring buffer: last 50 KB of PTY output for reconnect replay */
  private _buffer = "";
  private static readonly BUFFER_MAX = 50 * 1024; // 50 KB
  /** Mutable data listener — replaced by ws-server on connect/disconnect */
  private _onData: (data: string) => void;
  /** Additional exit listeners — ws-server hooks in to send session_end to browser */
  private _exitListeners: Array<(exitCode: number) => void> = [];

  // Idle detection fields (NTFY-06, NTFY-07)
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _idleThresholdMs: number;
  private _onIdle: (() => void) | null;
  private _idleFired = false;

  constructor(
    taskId: string,
    command: string,
    args: string[],
    cwd: string,
    onData: (data: string) => void,
    onExit: (exitCode: number, signal?: number) => void,
    envOverrides?: Record<string, string>,
    onIdle?: () => void,
    idleThresholdMs?: number
  ) {
    this.taskId = taskId;
    this._onData = onData;
    this._onIdle = onIdle ?? null;
    this._idleThresholdMs = Math.max(idleThresholdMs ?? 180_000, 180_000);

    // Build env: inherit full parent env, strip Claude nesting vars, ensure PATH exists
    const baseEnv = stripClaudeNestingEnv(ensurePathInEnv(process.env));
    this._pty = pty.spawn(command, args, {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd,
      env: {
        ...baseEnv,
        TERM: "xterm-color",
        ...envOverrides,
      } as Record<string, string>,
    });

    this._pty.onData((data) => {
      // Update ring buffer — keep last BUFFER_MAX bytes
      this._buffer += data;
      if (this._buffer.length > PtySession.BUFFER_MAX) {
        this._buffer = this._buffer.slice(
          this._buffer.length - PtySession.BUFFER_MAX
        );
      }
      // NTFY-06: reset idle timer on every PTY output
      this._resetIdleTimer();
      this._onData(data);
    });

    // D-07: onExit sets killed=true but does NOT call pty.kill()
    this._pty.onExit(({ exitCode, signal }) => {
      this.killed = true;
      // Clear idle timer on PTY exit — no callbacks fire after session ends
      if (this._idleTimer) {
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
      }
      onExit(exitCode, signal);
      // Notify all registered exit listeners (ws-server uses this)
      for (const listener of this._exitListeners) {
        listener(exitCode);
      }
    });

    // Start initial idle countdown
    this._resetIdleTimer();
  }

  /**
   * Reset the idle timer. Fires _onIdle after _idleThresholdMs of no activity.
   * Called on PTY output and on user write() to reset the countdown.
   */
  private _resetIdleTimer(): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    if (this._onIdle === null || this.killed || this._idleFired) {
      return;
    }
    this._idleTimer = setTimeout(() => {
      this._idleFired = true;
      this._onIdle?.();
    }, this._idleThresholdMs);
  }

  /**
   * Replace the live data listener — called by ws-server on connect/disconnect.
   * Allows startPtyExecution to pre-create the session with a no-op onData,
   * then the WebSocket handler wires in the real broadcaster on first connect.
   */
  setDataListener(fn: (data: string) => void): void {
    this._onData = fn;
  }

  /** Register a callback for PTY exit — ws-server uses this to send session_end.
   *  Replaces previous listeners to prevent accumulation on reconnect. */
  setExitListener(fn: (exitCode: number | undefined) => void): void {
    this._exitListeners = [fn];
  }

  write(data: string): void {
    if (!this.killed) {
      // NTFY-07: user input resets idle timer
      this._resetIdleTimer();
      this._pty.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (!this.killed) {
      this._pty.resize(cols, rows);
    }
  }

  /** Returns buffered output for reconnect replay */
  getBuffer(): string {
    return this._buffer;
  }

  /** Returns true if the idle callback has fired — Phase 34 MCP tools use this */
  get isIdle(): boolean {
    return this._idleFired;
  }

  /** D-06: double-kill guard */
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    // Clear idle timer when session is killed
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    try {
      this._pty.kill();
    } catch {
      // Already dead — safe to ignore
    }
  }
}
