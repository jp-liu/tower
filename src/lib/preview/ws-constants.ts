// Client-safe WebSocket constants for the preview channel.
// Kept separate from src/lib/pty/ws-server.ts so client bundles (preview-panel /
// preview-log-terminal) can reference these without dragging node-pty / fs into
// the browser build.

export const PREVIEW_TASK_ID = "__preview__";

export interface PreviewWsParams {
  role: "state" | "terminal";
  previewKey: string;
  connectionId: string;
  taskId: string | null;
}

export function parsePreviewWsParams(params: URLSearchParams): PreviewWsParams | null {
  if (params.get("taskId") !== PREVIEW_TASK_ID) return null;
  const role = params.get("role");
  const previewKey = params.get("previewKey");
  if ((role !== "state" && role !== "terminal") || !previewKey) return null;
  const connectionId = params.get("connectionId") ?? Math.random().toString(36).slice(2);
  return {
    role,
    previewKey: decodeURIComponent(previewKey),
    connectionId,
    taskId: params.get("clientTaskId"),
  };
}
