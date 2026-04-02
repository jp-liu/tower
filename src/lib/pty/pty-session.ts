import * as pty from "node-pty";

export class PtySession {
  readonly taskId: string;
  private readonly _pty: pty.IPty;
  killed = false;
  disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ring buffer: last 50 KB of PTY output for reconnect replay */
  private _buffer = "";
  private static readonly BUFFER_MAX = 50 * 1024; // 50 KB

  constructor(
    taskId: string,
    command: string,
    args: string[],
    cwd: string,
    onData: (data: string) => void,
    onExit: (exitCode: number, signal?: number) => void
  ) {
    this.taskId = taskId;
    this._pty = pty.spawn(command, args, {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    });

    this._pty.onData((data) => {
      // Update ring buffer — keep last BUFFER_MAX bytes
      this._buffer += data;
      if (this._buffer.length > PtySession.BUFFER_MAX) {
        this._buffer = this._buffer.slice(
          this._buffer.length - PtySession.BUFFER_MAX
        );
      }
      onData(data);
    });

    // D-07: onExit sets killed=true but does NOT call pty.kill()
    this._pty.onExit(({ exitCode, signal }) => {
      this.killed = true;
      onExit(exitCode, signal);
    });
  }

  write(data: string): void {
    if (!this.killed) {
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

  /** D-06: double-kill guard */
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    try {
      this._pty.kill();
    } catch {
      // Already dead — safe to ignore
    }
  }
}
