"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { getConfigValue } from "@/actions/config-actions";

interface StopEvent {
  taskId: string;
  taskTitle: string;
  sessionId: string;
  workspaceId: string;
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
  const router = useRouter();
  const routerRef = useRef(router);
  const enabledRef = useRef(enabled);
  const { t } = useI18n();
  const tRef = useRef(t);

  routerRef.current = router;
  enabledRef.current = enabled;
  tRef.current = t;

  useEffect(() => {
    if (typeof window === "undefined" || !enabled) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      const wsPort = await getConfigValue<number>("terminal.wsPort", 3001);
      ws = new WebSocket(
        `ws://localhost:${wsPort}/terminal?taskId=__notifications__`
      );

      ws.onmessage = (e) => {
        if (!enabledRef.current) return;
        try {
          const event = JSON.parse(e.data) as NotificationEvent;
          if (isStopEvent(event)) {
            toast.info(event.taskTitle, {
              description: tRef.current("notification.taskCompleted"),
              duration: 3000,
            });
          } else {
            // Completion event
            if (
              typeof window !== "undefined" &&
              "Notification" in window &&
              window.Notification.permission === "granted"
            ) {
              const n = new window.Notification("Tower", {
                body: event.taskTitle,
                icon: "/web-app-manifest-192x192.png",
              });
              n.onclick = () => {
                window.focus();
                routerRef.current.push(
                  `/workspaces/${event.workspaceId}/tasks/${event.taskId}`
                );
                n.close();
              };
            } else {
              toast.info(event.taskTitle, {
                description:
                  event.status === "COMPLETED"
                    ? tRef.current("notification.taskCompleted")
                    : tRef.current("notification.taskFailed"),
              });
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        // Reconnect after 5s
        reconnectTimer = setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
