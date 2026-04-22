"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Loader2, Clock, PlayCircle, RotateCcw, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface Execution {
  id: string;
  status: string;
  summary?: string | null;
  sessionId?: string | null;
  gitLog?: string | null;
  gitStats?: string | null;
  exitCode?: number | null;
  terminalLog?: string | null;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
  insightNote?: {
    id: string;
    title: string;
    content: string;
  } | null;
}

interface ExecutionTimelineProps {
  executions: Execution[];
  onResume?: (sessionId: string) => void;
  onContinueLatest?: () => void;
}

interface GitStats {
  commits?: number;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
}

function parseGitStats(raw: string | null): GitStats | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GitStats;
  } catch {
    return null;
  }
}

function formatDuration(start: Date | string | null, end: Date | string | null): string {
  if (!start || !end) return "";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatTime(date: Date | string | null, locale: string = "zh"): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const loc = locale === "zh" ? "zh-CN" : "en-US";
  const time = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });

  if (diffDays === 0) return time;
  if (diffDays === 1) return locale === "zh" ? `昨天 ${time}` : `Yesterday ${time}`;
  if (diffDays < 7) return locale === "zh" ? `${diffDays}天前 ${time}` : `${diffDays}d ago ${time}`;
  return d.toLocaleDateString(loc, { month: "2-digit", day: "2-digit" }) + " " + time;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "COMPLETED":
      return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "FAILED":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "RUNNING":
      return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />;
    default:
      return <Clock className="h-4 w-4 text-neutral-500" />;
  }
}

function statusLabel(status: string, t: (key: "execution.success" | "execution.failed" | "execution.running") => string): string {
  switch (status) {
    case "COMPLETED": return t("execution.success");
    case "FAILED": return t("execution.failed");
    case "RUNNING": return t("execution.running");
    default: return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "COMPLETED": return "text-emerald-400";
    case "FAILED": return "text-red-400";
    case "RUNNING": return "text-blue-400";
    default: return "text-neutral-400";
  }
}

export function ExecutionTimeline({ executions, onResume, onContinueLatest }: ExecutionTimelineProps) {
  const { t, locale } = useI18n();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [insightExpandedId, setInsightExpandedId] = useState<string | null>(null);

  if (executions.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        {t("execution.noHistory")}
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("execution.history")}
      </p>
      {executions.map((exec) => {
        const stats = parseGitStats(exec.gitStats ?? null);
        const duration = formatDuration(exec.startedAt ?? null, exec.endedAt ?? null);
        const isExpanded = expandedId === exec.id;

        return (
          <div
            key={exec.id}
            className="rounded-lg border border-border bg-background/50 overflow-hidden"
          >
            {/* Card content */}
            <div className="p-3">
              {/* Line 1: status icon + status + time + duration */}
              <div className="flex items-center gap-2 text-xs">
                <StatusIcon status={exec.status} />
                <span className={`font-medium ${statusColor(exec.status)}`}>
                  {statusLabel(exec.status, t)}
                </span>
                <span className="text-muted-foreground">{formatTime(exec.startedAt ?? null, locale)}</span>
                {duration && (
                  <span className="text-muted-foreground/60">({duration})</span>
                )}
              </div>
              {/* Line 2: summary */}
              <p className="mt-1.5 text-sm text-foreground/80 line-clamp-2">
                {exec.summary || t("execution.noSummary")}
              </p>
              {/* Line 3: git stats */}
              {stats && (stats.commits || stats.filesChanged) && (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                  {stats.commits ? <span>{stats.commits} {t("execution.commits")}</span> : null}
                  {stats.filesChanged ? (
                    <>
                      <span>·</span>
                      <span>{stats.filesChanged} {t("execution.files")}</span>
                    </>
                  ) : null}
                  {(stats.insertions || stats.deletions) ? (
                    <>
                      <span>·</span>
                      {stats.insertions ? <span className="text-emerald-500">+{stats.insertions}</span> : null}
                      {stats.deletions ? <span className="text-red-400">-{stats.deletions}</span> : null}
                    </>
                  ) : null}
                </div>
              )}
              {/* Insight row */}
              {exec.insightNote && (
                <div className="mt-2">
                  <button
                    onClick={() => setInsightExpandedId(insightExpandedId === exec.id ? null : exec.id)}
                    className="flex items-center gap-1.5 text-xs text-amber-300/90 hover:text-amber-200 transition-colors"
                  >
                    <Lightbulb className="h-3.5 w-3.5" />
                    <span className="font-medium">{t("execution.insight")}:</span>
                    <span className="text-foreground/70 truncate max-w-[200px]">{exec.insightNote.title}</span>
                    {insightExpandedId === exec.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                  {insightExpandedId === exec.id && (
                    <div className="mt-2 rounded-md bg-amber-500/5 border border-amber-500/10 p-3 text-xs text-foreground/80 whitespace-pre-wrap">
                      {exec.insightNote.content}
                    </div>
                  )}
                </div>
              )}
              {/* Action buttons */}
              <div className="mt-2.5 flex items-center gap-2">
                {exec.sessionId && onResume ? (
                  <Button
                    size="sm"
                    onClick={() => onResume(exec.sessionId!)}
                    className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20 hover:bg-amber-500/25"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    {t("execution.resume")}
                  </Button>
                ) : !exec.sessionId && exec.status === "FAILED" && exec.id === executions[0]?.id && onContinueLatest ? (
                  <Button
                    size="sm"
                    onClick={onContinueLatest}
                    className="bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/20 hover:bg-blue-500/25"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("execution.tryRecover")}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpandedId(isExpanded ? null : exec.id)}
                  className="bg-muted text-muted-foreground"
                >
                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {isExpanded ? t("execution.collapse") : t("execution.details")}
                </Button>
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="border-t border-border px-3 pb-3 space-y-3">
                {exec.gitLog && (
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      {t("execution.gitLog")}
                    </p>
                    <pre className="rounded-md bg-muted/50 p-2.5 text-xs font-mono text-foreground/70 overflow-x-auto whitespace-pre-wrap">
                      {exec.gitLog.split("\n").slice(0, 3).join("\n")}
                    </pre>
                  </div>
                )}

                {exec.terminalLog && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      {t("execution.terminalOutput")}
                    </p>
                    <pre className="rounded-md bg-[#0f1419] p-2.5 text-xs font-mono text-neutral-300 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {exec.terminalLog}
                    </pre>
                  </div>
                )}

                {exec.status === "FAILED" && exec.exitCode != null && (
                  <p className="text-xs text-red-400/70">
                    Exit code: {exec.exitCode}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
