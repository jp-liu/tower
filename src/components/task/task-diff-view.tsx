"use client";

import { useState } from "react";
import { ChevronRight, ChevronDown, GitMerge, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TaskMergeConfirmDialog } from "./task-merge-confirm-dialog";

interface DiffFileEntry {
  filename: string;
  added: number;
  removed: number;
  isBinary: boolean;
  patch: string;
}

interface TaskDiffViewProps {
  files: DiffFileEntry[];
  totalAdded: number;
  totalRemoved: number;
  hasConflicts: boolean;
  conflictFiles: string[];
  commitCount: number;
  taskId: string;
  taskTitle: string;
  taskStatus: string;
  baseBranch: string;
  onMergeComplete: () => void;
}

export function TaskDiffView({
  files,
  totalAdded,
  totalRemoved,
  hasConflicts,
  conflictFiles,
  commitCount,
  taskId,
  taskTitle,
  taskStatus,
  baseBranch,
  onMergeComplete,
}: TaskDiffViewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [showMergeDialog, setShowMergeDialog] = useState(false);

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{files.length} files changed</span>
          <span className="text-green-400 font-mono text-xs">+{totalAdded}</span>
          <span className="text-red-400 font-mono text-xs">-{totalRemoved}</span>
        </div>
        {taskStatus === "IN_REVIEW" && (
          <Button
            size="sm"
            onClick={() => setShowMergeDialog(true)}
            disabled={hasConflicts}
            className="h-8 gap-2 px-3 text-sm"
          >
            <GitMerge className="h-4 w-4" />
            Merge
          </Button>
        )}
      </div>

      {/* Conflict warning */}
      {hasConflicts && (
        <div className="flex flex-col gap-2 border-b border-border bg-amber-500/5 px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm font-medium">
              Merge blocked: {conflictFiles.length} conflicting file{conflictFiles.length !== 1 ? "s" : ""}
            </span>
          </div>
          <ul className="ml-6 space-y-1">
            {conflictFiles.map((file) => (
              <li key={file} className="text-xs font-mono text-amber-300/80">
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {files.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">No changes detected</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {files.map((file) => {
              const isExpanded = expandedFiles.has(file.filename);
              return (
                <div key={file.filename}>
                  {/* File header row */}
                  <button
                    type="button"
                    onClick={() => toggleFile(file.filename)}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/50 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate text-sm font-mono text-foreground">
                      {file.filename}
                    </span>
                    {file.isBinary ? (
                      <Badge
                        variant="secondary"
                        className="text-[10px] bg-muted text-muted-foreground border border-border"
                      >
                        Binary
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-green-400">+{file.added}</span>
                        <span className="text-xs font-mono text-red-400">-{file.removed}</span>
                      </div>
                    )}
                  </button>

                  {/* Expanded patch content */}
                  {isExpanded && file.patch && (
                    <div className="border-t border-border bg-background">
                      <pre className="overflow-x-auto p-0 text-xs font-mono leading-5">
                        {file.patch.split("\n").map((line, idx) => {
                          let lineClass = "px-4 block";
                          if (line.startsWith("+") && !line.startsWith("+++")) {
                            lineClass += " bg-green-500/10 text-green-400";
                          } else if (line.startsWith("-") && !line.startsWith("---")) {
                            lineClass += " bg-red-500/10 text-red-400";
                          } else if (line.startsWith("@@")) {
                            lineClass += " bg-blue-500/10 text-blue-300";
                          } else {
                            lineClass += " text-muted-foreground";
                          }
                          return (
                            <span key={idx} className={lineClass}>
                              {line || " "}
                            </span>
                          );
                        })}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Merge confirm dialog */}
      <TaskMergeConfirmDialog
        open={showMergeDialog}
        onOpenChange={setShowMergeDialog}
        taskId={taskId}
        taskTitle={taskTitle}
        baseBranch={baseBranch}
        fileCount={files.length}
        commitCount={commitCount}
        onMergeComplete={onMergeComplete}
      />
    </div>
  );
}
