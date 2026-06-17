"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { getActualWsPort } from "@/actions/config-actions";

interface StopEvent {
  taskId: string;
  taskTitle: string;
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  projectName: string;
  type: "stop";
  timestamp: string;
}

interface CompletionEvent {
  taskId: string;
  taskTitle: string;
  status: "COMPLETED" | "FAILED";
  executionId: string;
  workspaceId: string;
  type?: "completion";
}

type NotificationEvent = StopEvent | CompletionEvent;

function isStopEvent(e: NotificationEvent): e is StopEvent {
  return "type" in e && e.type === "stop";
}

export function useNotificationListener(enabled: boolean) {
  const enabledRef = useRef(enabled);
  const { t } = useI18n();
  const tRef = useRef(t);

  enabledRef.current = enabled;
  tRef.current = t;

  useEffect(() => {
    if (typeof window === "undefined" || !enabled) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // Shared notifier: desktop Notification when permission granted, otherwise a
    // green success toast. The notification is informational only — no click
    // navigation (clicking keeps the browser's default behavior).
    function notify(title: string, body: string) {
      if (
        typeof window !== "undefined" &&
        "Notification" in window &&
        window.Notification.permission === "granted"
      ) {
        new window.Notification(title, {
          body,
          icon: "/web-app-manifest-192x192.png",
        });
      } else {
        toast.success(title, { description: body });
      }
    }

    async function connect() {
      if (cancelled) return;
      const wsPort = await getActualWsPort();
      if (cancelled) return;

      ws = new WebSocket(
        `ws://localhost:${wsPort}/terminal?taskId=__notifications__`
      );

      ws.onmessage = (e) => {
        if (!enabledRef.current) return;
        try {
          const event = JSON.parse(e.data) as NotificationEvent;
          const t = tRef.current;
          if (isStopEvent(event)) {
            // Claude finished a reply turn → notify with workspace/project trace.
            notify(
              event.taskTitle,
              `${event.projectName}：${t("notification.taskReplied")}`
            );
          } else {
            // Completion event (manual stop / natural completion)
            notify(
              event.taskTitle,
              event.status === "COMPLETED"
                ? t("notification.taskCompleted")
                : t("notification.taskFailed")
            );
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        // Reconnect after 5s
        reconnectTimer = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
