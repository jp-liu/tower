import type { PreviewPreset } from "./preset-types";
import { extractUrl } from "./url-extractor";

export class ReadyWatcher {
  private ready = false;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private pendingExtractedUrl: string | null = null;

  constructor(
    private readonly preset: PreviewPreset | null,
    private readonly port: number,
    private readonly timeoutMs: number,
    private readonly onReady: (url: string | null) => void,
    private readonly onTimeout: () => void
  ) {}

  start(): void {
    this.timeoutTimer = setTimeout(() => {
      if (this.ready) return;
      this.onTimeout();
    }, this.timeoutMs);

    this.probeTimer = setInterval(() => {
      if (this.ready) return;
      void this.probe();
    }, 500);
  }

  feedLine(line: string): void {
    if (this.ready) return;
    if (this.preset?.urlExtractRegex) {
      const url = extractUrl(line, this.preset.urlExtractRegex);
      if (url) this.pendingExtractedUrl = url;
    }
    if (this.preset?.readyRegex?.test(line)) {
      this.emitReady(this.pendingExtractedUrl);
    }
  }

  stop(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private async probe(): Promise<void> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 200);
      const resp = await fetch(`http://localhost:${this.port}/`, {
        method: "HEAD",
        signal: controller.signal,
      });
      clearTimeout(t);
      if (resp.status >= 200 && resp.status < 400) {
        this.emitReady(this.pendingExtractedUrl);
      }
    } catch {
      // server not ready yet
    }
  }

  private emitReady(url: string | null): void {
    if (this.ready) return;
    this.ready = true;
    this.stop();
    this.onReady(url);
  }
}
