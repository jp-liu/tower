"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface NoteEditorProps {
  value: string;
  onChange: (val: string) => void;
}

export function NoteEditor({ value, onChange }: NoteEditorProps) {
  return (
    <div className="grid grid-cols-2 gap-4 min-h-96 flex-1">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="resize-none font-mono text-sm h-full min-h-0 border rounded-md p-3 bg-background text-foreground border-border focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        placeholder="Write Markdown here..."
      />
      <div className="prose prose-sm dark:prose-invert overflow-y-auto border rounded-md p-3 border-border h-full min-h-0">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
      </div>
    </div>
  );
}
