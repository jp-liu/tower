"use client";

import { useEffect, type ReactNode } from "react";
import { useShortcutStore, selectAllShortcuts } from "./shortcut-store";
import { resolveShortcut, isFormField } from "./shortcut-dispatcher";

/**
 * Attaches the single global `keydown` listener (capture phase) that drives the
 * whole shortcut system. Renders children unchanged — hooks talk to the store
 * directly, so no context value is exposed.
 */
export function ShortcutProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const entries = selectAllShortcuts(useShortcutStore.getState());
      if (entries.length === 0) return;

      const activeIsFormField = isFormField(document.activeElement);
      const hit = resolveShortcut(entries, event, activeIsFormField);
      if (!hit) return;

      if (hit.preventDefault !== false) {
        event.preventDefault();
      }
      event.stopPropagation();
      hit.handler(event);
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, []);

  return <>{children}</>;
}
