/**
 * Derive a display title for an assistant session from the durable on-disk
 * metadata returned by the Claude Agent SDK's `listSessions`.
 *
 * The raw `firstPrompt` carries Tower's injected scaffolding — the
 * `[Context: ...]` identity prefix, the `/tower` skill prefix, the
 * `<command-args>` XML wrapping, and the appended attachment block. Strip all
 * of it so the title reads like the user's actual first message (matching what
 * `buildSessionTitle` produces client-side for freshly-created sessions).
 */

/** Subset of the SDK's SDKSessionInfo that we consume for titling. */
export interface DiskSessionInfo {
  sessionId: string;
  summary?: string;
  firstPrompt?: string;
  customTitle?: string;
  createdAt?: number;
  lastModified: number;
}

const MAX_TITLE = 30;

function truncate(s: string): string {
  return s.length > MAX_TITLE ? s.slice(0, MAX_TITLE) : s;
}

/** Strip Tower's injected prefixes/wrappers from a raw prompt or summary. */
export function cleanPrompt(raw: string): string {
  let t = raw;
  // Identity context prefix injected on the first turn (chat route).
  t = t.replace(/^\[Context:[^\]]*\]\s*/, "");
  // Skill XML wrapping: <command-args>actual text</command-args>
  const argsMatch = t.match(/<command-args>([\s\S]*?)<\/command-args>/);
  if (argsMatch) t = argsMatch[1];
  // /tower skill prefix re-issued on every turn. Strip it even when nothing
  // follows ("/tower" alone is pure scaffolding, not a usable title).
  t = t.replace(/^\/tower(?:\s+|$)/, "");
  // Attachment block appended by buildAttachmentPrompt (current + legacy form).
  t = t.replace(
    /\n---\nThe user has attached the following (?:file|image)\(s\)[\s\S]*$/,
    ""
  );
  return t.trim();
}

/**
 * Title priority: user-set custom title → cleaned first prompt → cleaned
 * summary → fallback. `firstPrompt` is preferred over `summary` because it
 * matches the existing "title from first message" convention and is stable
 * across turns, whereas `summary` tracks the latest topic.
 */
export function deriveSessionTitle(s: DiskSessionInfo): string {
  if (s.customTitle?.trim()) return truncate(s.customTitle.trim());
  const fromPrompt = s.firstPrompt ? cleanPrompt(s.firstPrompt) : "";
  if (fromPrompt) return truncate(fromPrompt);
  const fromSummary = s.summary ? cleanPrompt(s.summary) : "";
  if (fromSummary) return truncate(fromSummary);
  return "New Session";
}
