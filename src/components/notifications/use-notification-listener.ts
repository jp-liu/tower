"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import type { TaskCompletionPayload } from "@/actions/onboarding-actions";

function fireNotification(
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

export function useNotificationListener(enabled: boolean) {
  const router = useRouter();
  const enabledRef = useRef(enabled);
  const { t } = useI18n();
  const tRef = useRef(t);

  enabledRef.current = enabled;
  tRef.current = t;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const interval = setInterval(async () => {
      if (!enabledRef.current) return;
      try {
        const res = await fetch("/api/internal/notifications/pending");
        if (!res.ok) return;
        const data = (await res.json()) as { events: TaskCompletionPayload[] };
        for (const event of data.events) {
          fireNotification(event, router, tRef.current);
        }
      } catch {
        // Silently ignore network errors — notifications are non-critical
      }
    }, 4000);

    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
