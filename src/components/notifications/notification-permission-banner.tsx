"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";

interface NotificationPermissionBannerProps {
  onDismiss?: () => void;
}

export function NotificationPermissionBanner({ onDismiss }: NotificationPermissionBannerProps) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (window.Notification.permission === "default") {
      setShow(true);
    }
  }, []);

  const handleAllow = async () => {
    const result = await window.Notification.requestPermission();
    if (result !== "default") {
      setShow(false);
      onDismiss?.();
    }
  };

  const handleDismiss = () => {
    setShow(false);
    onDismiss?.();
  };

  if (!show) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] w-auto max-w-lg bg-card border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-500">
      <Bell className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1 text-sm">{t("notification.permissionPrompt")}</span>
      <Button size="default" onClick={handleAllow}>{t("notification.allow")}</Button>
      <Button variant="ghost" size="default" onClick={handleDismiss}>
        {t("notification.dismiss")}
      </Button>
    </div>
  );
}
