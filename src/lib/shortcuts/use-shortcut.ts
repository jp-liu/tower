"use client";

import { useEffect, useRef } from "react";
import { useShortcutStore } from "./shortcut-store";
import type { ShortcutBinding } from "./types";

type ShortcutOptions = Omit<ShortcutBinding, "keys" | "handler">;

type UseShortcutArgs =
  | [keys: string | string[], handler: (event: KeyboardEvent) => void, opts?: ShortcutOptions]
  | [bindings: ShortcutBinding | ShortcutBinding[]];

/** Normalize the overloaded call signatures into a list of bindings. */
function toBindings(args: UseShortcutArgs): ShortcutBinding[] {
  const first = args[0];
  // useShortcut(keys, handler, opts?)
  if (typeof first === "string" || Array.isArray(first)) {
    // Disambiguate: ShortcutBinding[] arrays have objects, key arrays have strings.
    if (Array.isArray(first) && first.length > 0 && typeof first[0] !== "string") {
      return first as ShortcutBinding[];
    }
    const handler = args[1] as (event: KeyboardEvent) => void;
    const opts = (args[2] as ShortcutOptions | undefined) ?? {};
    return [{ keys: first as string | string[], handler, ...opts }];
  }
  // useShortcut(binding) | useShortcut([binding, ...])
  return Array.isArray(first) ? (first as ShortcutBinding[]) : [first];
}

/**
 * Build a stable, serializable key that changes only when the registration-
 * relevant (non-handler) options change — so we don't re-register on every
 * render just because a handler closure's identity changed.
 */
function depKey(bindings: ShortcutBinding[]): string {
  return JSON.stringify(
    bindings.map((b) => ({
      keys: b.keys,
      scope: b.scope,
      description: b.description,
      group: b.group,
      allowInInput: b.allowInInput,
      preventDefault: b.preventDefault,
      priority: b.priority,
      hidden: b.hidden,
      hasWhen: typeof b.when === "function",
    }))
  );
}

/**
 * Register one or more keyboard shortcuts for the lifetime of the calling
 * component. Handlers (and `when`) are kept in refs so changing their identity
 * does not trigger re-registration; the bindings are only re-registered when the
 * serializable options change.
 */
export function useShortcut(...args: UseShortcutArgs): void {
  const bindings = toBindings(args);
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  const register = useShortcutStore((s) => s.register);
  const unregister = useShortcutStore((s) => s.unregister);

  const key = depKey(bindings);

  useEffect(() => {
    const current = bindingsRef.current;
    const ids = current.map((binding, index) =>
      register({
        ...binding,
        // Route through the ref so the latest handler/when always run.
        handler: (event) => bindingsRef.current[index]?.handler(event),
        when: binding.when
          ? () => bindingsRef.current[index]?.when?.() ?? true
          : undefined,
      })
    );
    return () => {
      for (const id of ids) unregister(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, register, unregister]);
}
