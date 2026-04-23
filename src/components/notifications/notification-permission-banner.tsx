"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";

export function NotificationPermissionBanner() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    setShow(window.Notification.permission === "default");
  }, []);

  const handleAllow = async () => {
    const result = await window.Notification.requestPermission();
    if (result !== "default") {
      setShow(false);
    }
  };

  const handleDismiss = () => {
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed top-12 left-0 right-0 z-40 mx-auto max-w-2xl bg-card border rounded-lg shadow-md p-3 flex items-center gap-3">
      <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm">{t("notification.permissionPrompt")}</span>
      <Button onClick={handleAllow}>{t("notification.allow")}</Button>
      <Button variant="ghost" onClick={handleDismiss}>
        {t("notification.dismiss")}
      </Button>
    </div>
  );
}
