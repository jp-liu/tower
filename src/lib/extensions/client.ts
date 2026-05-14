"use client";

import { useContext } from "react";
import { ExtensionContext } from "./context";
import type { ExtensionId, ExtensionStatus, ExtensionResult } from "./types";

export interface UseExtensionReturn {
  status: ExtensionStatus;
  loading: boolean;
  isInstalling: boolean;
  install(): Promise<ExtensionResult>;
  uninstall(): Promise<ExtensionResult>;
  refresh(): Promise<void>;
}

export function useExtension(id: ExtensionId): UseExtensionReturn {
  const ctx = useContext(ExtensionContext);
  if (!ctx) {
    throw new Error("useExtension must be used inside <ExtensionProvider>");
  }
  return {
    status: ctx.statusMap[id],
    loading: ctx.loading,
    isInstalling: ctx.installing.has(id),
    install: () => ctx.install(id),
    uninstall: () => ctx.uninstall(id),
    refresh: () => ctx.refresh(id),
  };
}

export function useAllExtensions() {
  const ctx = useContext(ExtensionContext);
  if (!ctx) {
    throw new Error("useAllExtensions must be used inside <ExtensionProvider>");
  }
  return ctx.statusMap;
}
