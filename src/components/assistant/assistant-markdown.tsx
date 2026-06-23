"use client";

import { Streamdown } from "streamdown";

// ---------------------------------------------------------------------------
// Assistant markdown — thin wrapper over Streamdown, a streaming-aware
// drop-in for react-markdown. It natively parses incomplete markdown
// (unclosed tables / code fences) so no plain-text fallback is needed.
// Element styling comes from Streamdown's baked-in Tailwind classes; the
// `@source` directive in globals.css makes Tailwind emit them.
// ---------------------------------------------------------------------------

export function AssistantMarkdown({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  return (
    <Streamdown
      // Streamdown wraps tables in an overflow-x-auto container and makes <th>
      // nowrap, but leaves <td> wrapping — so with its w-full table the cells
      // squeeze/wrap instead of the table overflowing and scrolling. Make <td>
      // nowrap too: columns size to content, the table exceeds the bubble width,
      // and the existing wrapper scrolls horizontally.
      //
      // break-words: long unbroken words/URLs in body text wrap at the bubble
      // edge instead of overflowing. Inline <code> (paths like
      // /Users/.../assets/...) has no wrapping by default — force wrap + break-all
      // so it stays inside the bubble. The `:not(pre)>code` guard excludes fenced
      // code blocks, which keep their own overflow-x-auto horizontal scroll.
      className="text-sm leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_td]:whitespace-nowrap [&_:not(pre)>code]:whitespace-pre-wrap [&_:not(pre)>code]:break-all"
      mode={isStreaming ? "streaming" : "static"}
      animated
      isAnimating={isStreaming}
      caret={isStreaming ? "block" : undefined}
    >
      {content}
    </Streamdown>
  );
}
