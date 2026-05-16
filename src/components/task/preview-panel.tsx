"use client";

// TODO(Phase 4): Full PreviewPanel rewrite to use new preview-actions API
// (getPreviewState / startPreview({ taskId, projectId, worktreePath }) / stopPreview({ previewKey }))
// Stub added in Task 2.5 to unblock type-safe build after preview-actions rewrite.

export interface PreviewPanelProps {
  taskId: string;
  worktreePath: string | null;
  previewCommand: string | null;
  previewPort: number | null;
  refreshKey: number;
  projectId: string;
  previewUrl?: string;
  onPreviewUrlChange?: (url: string) => void;
}

export function PreviewPanel(_props: PreviewPanelProps) {
  return null;
}
