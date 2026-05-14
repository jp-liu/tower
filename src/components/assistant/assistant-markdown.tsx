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
      className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      mode={isStreaming ? "streaming" : "static"}
      animated
      isAnimating={isStreaming}
      caret={isStreaming ? "block" : undefined}
    >
      {content}
    </Streamdown>
  );
}
