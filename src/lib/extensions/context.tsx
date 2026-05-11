"use client";

import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  checkExtension,
  installExtension,
  listAllExtensionStatus,
  uninstallExtension,
} from "@/actions/extension-actions";
import { listExtensionMetadata } from "./metadata";
import type { ExtensionId, ExtensionStatus, ExtensionResult } from "./types";

type StatusMap = Record<ExtensionId, ExtensionStatus>;

const DEFAULT_STATUS: ExtensionStatus = { installed: false };

function buildInitialMap(): StatusMap {
  // Derived from metadata so adding a new extension definition automatically
  // gets a default status entry. metadata.ts is client-safe (no Node imports).
  return Object.fromEntries(
    listExtensionMetadata().map((meta) => [meta.id, DEFAULT_STATUS])
  ) as StatusMap;
}

export interface ExtensionContextValue {
  statusMap: StatusMap;
  loading: boolean;
  installing: ReadonlySet<ExtensionId>;
  refresh(id: ExtensionId): Promise<void>;
  install(id: ExtensionId): Promise<ExtensionResult>;
  uninstall(id: ExtensionId): Promise<ExtensionResult>;
}

export const ExtensionContext = createContext<ExtensionContextValue | null>(null);

export function ExtensionProvider({ children }: { children: ReactNode }) {
  const [statusMap, setStatusMap] = useState<StatusMap>(buildInitialMap);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<Set<ExtensionId>>(new Set());

  // Ref-based guard for synchronous concurrent-call detection.
  // State updates are batched/async; a ref provides an immediate, synchronous
  // check so that a second call arriving before React commits the first
  // setInstalling still sees the in-flight id.
  const inflightRef = useRef<Set<ExtensionId>>(new Set());

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
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async (id: ExtensionId) => {
    const status = await checkExtension(id);
    setStatusMap((prev) => ({ ...prev, [id]: status }));
  }, []);

  const guardedInstall = useCallback(
    async (id: ExtensionId): Promise<ExtensionResult> => {
      if (inflightRef.current.has(id)) {
        return { success: false, error: "install already in progress" };
      }
      inflightRef.current.add(id);
      setInstalling((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      try {
        const result = await installExtension(id);
        if (result.success) await refresh(id);
        return result;
      } finally {
        inflightRef.current.delete(id);
        setInstalling((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refresh]
  );

  const guardedUninstall = useCallback(
    async (id: ExtensionId): Promise<ExtensionResult> => {
      if (inflightRef.current.has(id)) {
        return { success: false, error: "operation already in progress" };
      }
      inflightRef.current.add(id);
      setInstalling((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      try {
        const result = await uninstallExtension(id);
        if (result.success) await refresh(id);
        return result;
      } finally {
        inflightRef.current.delete(id);
        setInstalling((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ statusMap, loading, installing, refresh, install: guardedInstall, uninstall: guardedUninstall }),
    [statusMap, loading, installing, refresh, guardedInstall, guardedUninstall]
  );

  return (
    <ExtensionContext.Provider value={value}>
      {children}
    </ExtensionContext.Provider>
  );
}
