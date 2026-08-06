import * as pty from "node-pty";
import { ensurePathInEnv, isWindows, stripClaudeNestingEnv, stripTowerRuntimeEnv } from "@/lib/platform";
import { notifyPtyInputStarted } from "./lifecycle";
import { planTerminalWrite } from "./terminal-submit";

export class PtySession {
  readonly taskId: string;
  readonly executionId: string | null;
  private readonly _pty: pty.IPty;
  killed = false;
  disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Parked waiting for a human reply (ask_human) → WS-disconnect keepalive is
   *  suspended so a long human wait can't reap the live terminal. See session-store
   *  parkSession/unparkSession and ws-server's disconnect handler. */
  parked = false;
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
  private _initialInputSent = false;
  private _pendingInputKeys = new Set<string>();
  private _acceptedInputKeys = new Set<string>();
  private static readonly INPUT_KEY_HISTORY_MAX = 256;
  private _turnState: "BUSY" | "IDLE";
  private _lastInputAt: number | null = null;

  constructor(
    taskId: string,
    command: string,
    args: string[],
    cwd: string,
    onData: (data: string) => void,
    onExit: (exitCode: number, signal?: number) => void,
    envOverrides?: Record<string, string>,
    onIdle?: () => void,
    idleThresholdMs?: number,
    baseEnvOverride?: Record<string, string>,
    startsAtInputBoundary = false,
    executionId?: string,
  ) {
    this.taskId = taskId;
    this.executionId = executionId ?? null;
    this._onData = onData;
    this._onIdle = onIdle ?? null;
    this._idleThresholdMs = Math.max(idleThresholdMs ?? 180_000, 180_000);
    this._turnState = startsAtInputBoundary ? "IDLE" : "BUSY";

    // Build env: inherit full parent env, strip Claude nesting vars and Tower's
    // own data-root config, ensure PATH exists
    const baseEnv = baseEnvOverride
      ? ensurePathInEnv({ ...baseEnvOverride })
      : stripTowerRuntimeEnv(stripClaudeNestingEnv(ensurePathInEnv(process.env)));
    const spawnEnv = {
      ...baseEnv,
      TERM: "xterm-color",
      ...envOverrides,
    } as Record<string, string>;

    try {
      this._pty = pty.spawn(command, args, {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd,
        env: spawnEnv,
      });
    } catch (err) {
      console.error(`[pty] spawn failed: command="${command}", cwd="${cwd}", PATH="${spawnEnv.PATH?.slice(0, 200)}"`);
      throw err;
    }

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
   * Called on PTY output and on submitted semantic input to reset the countdown.
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

  /** Forward terminal bytes without changing provider-turn ownership. */
  writeRaw(data: string): void {
    if (!this.killed) this._pty.write(data);
  }

  /** Forward a real submitted input and establish a new provider turn. */
  writeSubmittedInput(data: string): void {
    if (!this.killed) {
      this._turnState = "BUSY";
      this._lastInputAt = Date.now();
      notifyPtyInputStarted(this.taskId);
      // NTFY-07: user input resets idle timer
      this._resetIdleTimer();
      this._pty.write(data);
    }
  }

  claimInputKey(key: string): "claimed" | "pending" | "accepted" {
    if (this._acceptedInputKeys.has(key)) return "accepted";
    if (this._pendingInputKeys.has(key)) return "pending";
    this._pendingInputKeys.add(key);
    return "claimed";
  }

  acceptInputKey(key: string): void {
    this._pendingInputKeys.delete(key);
    this._acceptedInputKeys.add(key);
    while (this._acceptedInputKeys.size > PtySession.INPUT_KEY_HISTORY_MAX) {
      const oldest = this._acceptedInputKeys.values().next().value;
      if (oldest === undefined) break;
      this._acceptedInputKeys.delete(oldest);
    }
  }

  releaseInputKey(key: string): void {
    this._pendingInputKeys.delete(key);
  }

  /** Deliver a fresh-session prompt once, after the PTY is ready for input. */
  writeInitialInput(text: string): void {
    if (this._initialInputSent || this.killed) return;
    this._initialInputSent = true;
    const plan = planTerminalWrite(text, true);
    const bodyTimer = setTimeout(() => {
      if (this.killed) return;
      this.writeRaw(plan.body);
      if (plan.submitKey) {
        const submitTimer = setTimeout(() => this.writeSubmittedInput(plan.submitKey!), 25);
        submitTimer.unref?.();
      }
    }, 100);
    bodyTimer.unref?.();
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

  /** True only after the provider reported that the current turn completed. */
  get isAtTurnBoundary(): boolean {
    return this._turnState === "IDLE";
  }

  /** Timestamp fence used when recovering a missed provider completion. */
  get lastInputAt(): number | null {
    return this._lastInputAt;
  }

  /** Called by the provider stop/turn-complete callback, never by output-idle heuristics. */
  markTurnComplete(): void {
    if (!this.killed) this._turnState = "IDLE";
  }

  /** OS pid of the spawned process (claude CLI). Used to persist for orphan
   *  reaping across Tower restarts and to target the process group on kill. */
  get pid(): number {
    return this._pty.pid;
  }

  /** D-06: double-kill guard. Accepts optional signal (default SIGTERM). */
  kill(signal?: string): void {
    if (this.killed) return;
    this.killed = true;
    // Clear idle timer when session is killed
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    try {
      this._pty.kill(signal);
    } catch {
      // Already dead — safe to ignore
    }
  }

  /**
   * Force-kill the process bypassing the double-kill guard. Use when an
   * earlier SIGTERM didn't take effect within a reasonable timeout.
   */
  forceKill(): void {
    try {
      this._pty.kill("SIGKILL");
    } catch {
      // Already dead — safe to ignore
    }
    this.killed = true;
  }

  /**
   * Kill the ENTIRE process group, not just the immediate child.
   *
   * node-pty's `kill()` does `process.kill(this.pid, signal)` — it signals only
   * the spawned process (the claude CLI). But claude spawns its own children
   * (MCP servers, language servers) that inherit claude's process group (node-pty
   * runs the child as a setsid session leader, so pgid === claude's pid). Signalling
   * only claude leaves those children orphaned (reparented to pid 1) when claude is
   * force-killed or crashes — the "残留 node 进程" the user observes.
   *
   * Signalling the negative pid (`-pid`) targets the whole process group, reaping
   * claude + all its descendants. SIGTERM first for graceful shutdown, then a
   * SIGKILL escalation after `graceMs` for anything that ignores it (hung dev
   * servers, stuck MCP processes).
   *
   * On Windows there is no POSIX process group; node-pty's conpty/winpty backend
   * already terminates the whole job object tree, so we fall back to a plain kill.
   */
  killTree(graceMs = 3000): void {
    if (this.killed) return;
    this.killed = true;
    // Clear idle timer when session is killed
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }

    const pid = this._pty.pid;

    if (isWindows()) {
      // conpty/winpty terminates the whole process tree on kill
      try {
        this._pty.kill();
      } catch {
        // Already dead — safe to ignore
      }
      return;
    }

    try {
      // Negative pid → signal the whole process group (claude + descendants)
      process.kill(-pid, "SIGTERM");
    } catch {
      // Group already gone, or kill not permitted — fall back to single kill
      try {
        this._pty.kill();
      } catch {
        // Already dead — safe to ignore
      }
      return;
    }

    // Escalate to SIGKILL for any process that ignored SIGTERM. Unref so this
    // timer never keeps the Node event loop (or the parent process) alive.
    const t = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Already dead — safe to ignore
      }
    }, graceMs);
    t.unref?.();
  }
}
