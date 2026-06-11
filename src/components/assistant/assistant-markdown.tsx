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
      className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_td]:whitespace-nowrap"
      mode={isStreaming ? "streaming" : "static"}
      animated
      isAnimating={isStreaming}
      caret={isStreaming ? "block" : undefined}
    >
      {content}
    </Streamdown>
  );
}
