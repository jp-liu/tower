"use client";

import { createContext, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  checkExtension,
  installExtension,
  uninstallExtension,
} from "@/actions/extension-actions";
import { listExtensionMetadata } from "./metadata";
import type { ExtensionId, ExtensionStatus, ExtensionResult } from "./types";

type StatusMap = Record<ExtensionId, ExtensionStatus>;

const DEFAULT_STATUS: ExtensionStatus = { installed: false };

function buildDefaultMap(): StatusMap {
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

export function ExtensionProvider({
  children,
  initialStatus,
}: {
  children: ReactNode;
  /** Server-detected status map injected from RSC layout. Avoids a client
   * round-trip on first render. If omitted, falls back to "not installed"
   * defaults — caller should refresh manually. */
  initialStatus?: StatusMap;
}) {
  const [statusMap, setStatusMap] = useState<StatusMap>(
    () => initialStatus ?? buildDefaultMap()
  );
  const [installing, setInstalling] = useState<Set<ExtensionId>>(new Set());

  // Ref-based guard for synchronous concurrent-call detection.
  // State updates are batched/async; a ref provides an immediate, synchronous
  // check so that a second call arriving before React commits the first
  // setInstalling still sees the in-flight id.
  const inflightRef = useRef<Set<ExtensionId>>(new Set());

  // No mount-time fetch — initialStatus is computed server-side in layout.
  // Manual refresh button on each extension card handles external changes.

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

  // Always false now — status is server-injected at mount, no async loading state.
  // Kept on the context to avoid breaking consumers that destructure { loading }.
  const value = useMemo(
    () => ({ statusMap, loading: false, installing, refresh, install: guardedInstall, uninstall: guardedUninstall }),
    [statusMap, installing, refresh, guardedInstall, guardedUninstall]
  );

  return (
    <ExtensionContext.Provider value={value}>
      {children}
    </ExtensionContext.Provider>
  );
}
