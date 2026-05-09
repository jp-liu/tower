"use client";

import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  checkExtension,
  installExtension,
  listAllExtensionStatus,
  uninstallExtension,
} from "@/actions/extension-actions";
import type { ExtensionId, ExtensionStatus, ExtensionResult } from "./types";

type StatusMap = Record<ExtensionId, ExtensionStatus>;

const DEFAULT_STATUS: ExtensionStatus = { installed: false };
const INITIAL_MAP: StatusMap = { rg: DEFAULT_STATUS, monaco: DEFAULT_STATUS };

export interface ExtensionContextValue {
  statusMap: StatusMap;
  loading: boolean;
  refresh(id: ExtensionId): Promise<void>;
  install(id: ExtensionId): Promise<ExtensionResult>;
  uninstall(id: ExtensionId): Promise<ExtensionResult>;
}

export const ExtensionContext = createContext<ExtensionContextValue | null>(null);

export function ExtensionProvider({ children }: { children: ReactNode }) {
  const [statusMap, setStatusMap] = useState<StatusMap>(INITIAL_MAP);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listAllExtensionStatus()
      .then((map) => {
        if (cancelled) return;
        setStatusMap(map);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async (id: ExtensionId) => {
    const status = await checkExtension(id);
    setStatusMap((prev) => ({ ...prev, [id]: status }));
  }, []);

  const install = useCallback(
    async (id: ExtensionId): Promise<ExtensionResult> => {
      const result = await installExtension(id);
      if (result.success) await refresh(id);
      return result;
    },
    [refresh]
  );

  const uninstall = useCallback(
    async (id: ExtensionId): Promise<ExtensionResult> => {
      const result = await uninstallExtension(id);
      if (result.success) await refresh(id);
      return result;
    },
    [refresh]
  );

  return (
    <ExtensionContext.Provider value={{ statusMap, loading, refresh, install, uninstall }}>
      {children}
    </ExtensionContext.Provider>
  );
}
