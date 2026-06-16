"use client";

import { Fragment } from "react";
import { compactKeyList, renderComboTokens } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/** A single key cap. */
function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-[1.5rem] items-center justify-center rounded-md",
        "border border-border bg-muted px-1.5 py-0.5",
        "text-[11px] font-medium leading-none text-foreground",
        "shadow-[inset_0_-1px_0_var(--border)]"
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * Render one or more tinykeys binding strings as polished key caps.
 *
 * - Tokens within a combo are joined with a faint `+` (e.g. `⌘ + →`).
 * - Alternative bindings are separated with a faint `/`.
 * - Long 1..N digit runs collapse to a single range cap (e.g. `1–9`).
 */
export function KeyCombo({ keys }: { keys: string[] }) {
  const combos = compactKeyList(keys);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {combos.map((combo, ci) => (
        <span key={`${combo}-${ci}`} className="inline-flex items-center gap-1">
          {ci > 0 && (
            <span className="text-[11px] text-muted-foreground/40">/</span>
          )}
          {renderComboTokens(combo).map((token, ti) => (
            <Fragment key={ti}>
              {ti > 0 && (
                <span className="text-[10px] text-muted-foreground/60">+</span>
              )}
              <KeyCap>{token}</KeyCap>
            </Fragment>
          ))}
        </span>
      ))}
    </span>
  );
}
