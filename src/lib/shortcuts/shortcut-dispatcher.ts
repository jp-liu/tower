import { matchKeybindingPress } from "tinykeys";
import type { KeybindingPress } from "tinykeys";
import type { RegisteredShortcut } from "./types";

/**
 * True for native form fields and contenteditable hosts. Note: xterm's hidden
 * `.xterm-helper-textarea` is a TEXTAREA, so a focused terminal reports `true`
 * here — that is what makes the bare-key form guard double as an input-mode gate.
 */
export function isFormField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * True when the press requires a non-Shift modifier (Control / Meta / Alt).
 * Shift alone does NOT count as a modifier combo.
 */
export function isModifierCombo(press: KeybindingPress): boolean {
  const [requiredModifiers] = press;
  return requiredModifiers.some(
    (m) => m === "Control" || m === "Meta" || m === "Alt"
  );
}

/** Effective priority: route scopes outrank global, then explicit priority. */
function effectivePriority(entry: RegisteredShortcut): number {
  return (entry.priority ?? 0) + (entry.scope !== "global" ? 1000 : 0);
}

/**
 * Core selection logic. Pure & DOM-light: callers pass the entries snapshot,
 * the raw event, and whether the active element is a form field.
 *
 * 1. Candidates = entries with SOME single-press that matches the event AND
 *    whose `when?.()` is not false. (Multi-press sequences are ignored in v1.)
 * 2. Form guard: drop a candidate if the active element is a form field, the
 *    entry is not `allowInInput`, and the matched press is NOT a modifier combo.
 *    Modifier combos bypass the guard unless `allowInInput === false`.
 * 3. Sort by effective priority desc, tie-break by `seq` desc (later wins).
 */
export function resolveShortcut(
  entries: RegisteredShortcut[],
  event: KeyboardEvent,
  activeIsFormField: boolean
): RegisteredShortcut | null {
  const candidates: RegisteredShortcut[] = [];

  for (const entry of entries) {
    if (entry.when && entry.when() === false) continue;

    // Find the single-press that matches this event (ignore multi-press seqs).
    let matchedPress: KeybindingPress | null = null;
    for (const pressList of entry.presses) {
      if (pressList.length !== 1) continue;
      const press = pressList[0];
      if (matchKeybindingPress(event, press)) {
        matchedPress = press;
        break;
      }
    }
    if (!matchedPress) continue;

    // Form guard.
    if (activeIsFormField) {
      const combo = isModifierCombo(matchedPress);
      if (combo) {
        // Modifier combos bypass the guard unless explicitly disallowed.
        if (entry.allowInInput === false) continue;
      } else {
        // Bare keys are suppressed in form fields unless allowInInput is set.
        if (!entry.allowInInput) continue;
      }
    }

    candidates.push(entry);
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const pa = effectivePriority(a);
    const pb = effectivePriority(b);
    if (pa !== pb) return pb - pa;
    return b.seq - a.seq;
  });

  return candidates[0];
}
