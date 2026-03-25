import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface AgentEvent {
  type: "message" | "file_change" | "status" | "error";
  content: string;
  metadata?: Record<string, unknown>;
}

export class AgentRunner extends EventEmitter {
  private process: ChildProcess | null = null;
  private agent: string;
  private cwd: string;

  constructor(agent: string, cwd: string) {
    super();
    this.agent = agent;
    this.cwd = cwd;
  }

  async start(prompt: string): Promise<void> {
    if (this.agent === "CLAUDE_CODE") {
      this.process = spawn(
        "claude",
        ["-p", prompt, "--output-format", "stream-json"],
        {
          cwd: this.cwd,
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      this.process.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            this.emit("event", {
              type: "message",
              content: parsed.content ?? parsed.result ?? line,
              metadata: parsed,
            } satisfies AgentEvent);
          } catch {
            this.emit("event", {
              type: "message",
              content: line,
            } satisfies AgentEvent);
          }
        }
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        this.emit("event", {
          type: "error",
          content: data.toString(),
        } satisfies AgentEvent);
      });

      this.process.on("close", (code) => {
        this.emit("event", {
          type: "status",
          content: code === 0 ? "completed" : "failed",
        });
        this.emit("done", code);
      });

      this.process.on("error", (err) => {
        this.emit("event", {
          type: "error",
          content: `Agent process error: ${err.message}`,
        });
        this.emit("done", 1);
      });
    }
  }

  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}
