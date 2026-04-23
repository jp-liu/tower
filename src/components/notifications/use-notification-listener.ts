"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { TaskCompletionPayload } from "@/actions/onboarding-actions";

interface StopEvent {
  taskId: string;
  taskTitle: string;
  sessionId: string;
  workspaceId: string;
  type: "stop";
  timestamp: string;
}

function fireCompletionNotification(
  event: TaskCompletionPayload,
  router: ReturnType<typeof useRouter>,
  t: (key: TranslationKey) => string
) {
  if (
    typeof window !== "undefined" &&
    "Notification" in window &&
    window.Notification.permission === "granted"
  ) {
    const n = new Notification("Tower", {
      body: event.taskTitle,
      icon: "/web-app-manifest-192x192.png",
    });
    n.onclick = () => {
      window.focus();
      router.push(`/workspaces/${event.workspaceId}/tasks/${event.taskId}`);
      n.close();
    };
  } else {
    toast.info(event.taskTitle, {
      description:
        event.status === "COMPLETED"
          ? t("notification.taskCompleted")
          : t("notification.taskFailed"),
    });
  }
}

function fireStopNotification(event: StopEvent) {
  toast.info(event.taskTitle, {
    description: "AI 回复完成",
    duration: 3000,
  });
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
    if (typeof window === "undefined") return;

    const interval = setInterval(async () => {
      if (!enabledRef.current) return;
      try {
        const res = await fetch("/api/internal/notifications/pending");
        if (!res.ok) return;
        const data = (await res.json()) as {
          events: TaskCompletionPayload[];
          stopEvents: StopEvent[];
        };
        for (const event of data.events) {
          fireCompletionNotification(event, routerRef.current, tRef.current);
        }
        for (const event of data.stopEvents) {
          fireStopNotification(event);
        }
      } catch {
        // Silently ignore network errors — notifications are non-critical
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
