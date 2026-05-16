export interface DetectContext {
  files: Record<string, string | null>;
  hasDir: (rel: string) => boolean;
}

export interface PreviewPreset {
  id: string;
  name: string;
  icon: string;
  detect: (ctx: DetectContext) => boolean;
  command: string;
  port: number;
  installCommand: string | null;
  installMarker: string[] | null;
  installCwd?: "self" | "monorepo-root";
  readyRegex: RegExp | null;
  urlExtractRegex: RegExp | null;
  startTimeoutMs?: number;
  docUrl?: string;
}
